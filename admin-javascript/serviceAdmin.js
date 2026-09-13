/**
 * PGENRO IMS — Service Request & Course of Action
 * Page controller only. Shared admin shell/profile behavior is handled by admin-ui.js.
 * Storage remains routed through the Supabase compatibility layer.
 */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  document.addEventListener(
    'DOMContentLoaded',
    () => {
      window.lucide?.createIcons?.();

      const form = $('#serviceRequestForm');

      if (!form) return;

      const tabPanels = [
        'tab-client-info',
        'tab-service-request',
        'tab-course-action'
      ];

      const tabButtons = $$('.tab-btn');

      const displayActiveId = $('#displayActiveServiceNo');
      const displayStatusBadge = $('#displayActiveStatusBadge');

      const hiddenDocId = $('#docIdHidden');

      const btnPrevTab = $('#btnPrevTab');
      const btnNextTab = $('#btnNextTab');
      const btnSaveAction = $('#btnSaveAction');

      const summaryModal = $('#summaryModal');
      const searchModal = $('#searchModal');

      const modalSearchFilter = $('#modalSearchFilter');
      const quickSearchInput = $('#quickSearchInput');

      let activeTabIdx = 0;
      let serviceRecords = [];

      let db = null;
      let serviceRequestsRef = null;

      /* ================================================================
         UI HELPERS
      ================================================================= */

      const escapeHtml = (value) =>
        String(value ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#039;');

      function showToast(message, type = 'success') {
        if (window.AdminUI?.toast) {
          window.AdminUI.toast(message, type);
          return;
        }

        const container = $('#toastContainer');

        if (!container) return;

        const toast = document.createElement('div');

        toast.className = `toast ${type}`;

        toast.innerHTML = `
          <i
            data-lucide="${
              type === 'error'
                ? 'circle-alert'
                : type === 'warning'
                  ? 'triangle-alert'
                  : 'circle-check'
            }"
          ></i>

          <span>${escapeHtml(message)}</span>
        `;

        container.appendChild(toast);

        window.lucide?.createIcons?.();

        setTimeout(() => {
          toast.classList.add('toast-leaving');

          setTimeout(() => {
            toast.remove();
          }, 220);
        }, 3500);
      }

      function setDbStatus(online, message) {
        const dot = $('#dbStatusDot');
        const text = $('#dbStatusText');

        if (dot) {
          dot.className = online
            ? 'status-dot online'
            : 'status-dot offline';
        }

        if (text) {
          text.textContent = message;
        }
      }

      function setButtonHidden(button, hidden) {
        if (!button) return;

        button.classList.toggle('is-hidden', hidden);

        button.setAttribute(
          'aria-hidden',
          hidden ? 'true' : 'false'
        );

        if (hidden) {
          button.setAttribute('tabindex', '-1');
        } else {
          button.removeAttribute('tabindex');
        }
      }

      /* ================================================================
         CLOCK
      ================================================================= */

      function updateClock() {
        const clock = $('#liveClockDisplay span');

        if (!clock) return;

        clock.textContent = new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }).format(new Date());
      }

      updateClock();

      window.setInterval(updateClock, 1000);

      /* ================================================================
         TAB VALIDATION
      ================================================================= */

      function validateTab(tabIndex) {
        const panel = document.getElementById(
          tabPanels[tabIndex]
        );

        if (!panel) return true;

        const fields = $$(
          'input[required], select[required], textarea[required]',
          panel
        );

        for (const field of fields) {
          const value =
            typeof field.value === 'string'
              ? field.value.trim()
              : field.value;

          field.classList.remove('field-error');

          if (!value || !field.checkValidity()) {
            field.classList.add('field-error');

            field.focus({
              preventScroll: true
            });

            field.scrollIntoView({
              behavior: 'smooth',
              block: 'center'
            });

            field.reportValidity();

            const label =
              field.labels?.[0]?.textContent
                ?.replace('*', '')
                .trim() ||
              field.name ||
              'required field';

            showToast(
              `Please complete ${label}.`,
              'error'
            );

            return false;
          }
        }

        return true;
      }

      /* ================================================================
         STEP / TAB NAVIGATION
      ================================================================= */

      function switchTab(
        index,
        bypassValidation = false
      ) {
        if (
          index < 0 ||
          index >= tabPanels.length
        ) {
          return;
        }

        if (
          !bypassValidation &&
          index > activeTabIdx &&
          !validateTab(activeTabIdx)
        ) {
          return;
        }

        activeTabIdx = index;

        tabButtons.forEach((button, idx) => {
          const active =
            idx === activeTabIdx;

          button.classList.toggle(
            'active',
            active
          );

          button.setAttribute(
            'aria-selected',
            active ? 'true' : 'false'
          );

          button.setAttribute(
            'tabindex',
            active ? '0' : '-1'
          );
        });

        tabPanels.forEach(
          (panelId, idx) => {
            const panel =
              document.getElementById(panelId);

            if (!panel) return;

            const active =
              idx === activeTabIdx;

            panel.classList.toggle(
              'active',
              active
            );

            panel.setAttribute(
              'aria-hidden',
              active ? 'false' : 'true'
            );
          }
        );

        setButtonHidden(
          btnPrevTab,
          activeTabIdx === 0
        );

        setButtonHidden(
          btnNextTab,
          activeTabIdx ===
            tabPanels.length - 1
        );

        setButtonHidden(
          btnSaveAction,
          activeTabIdx !==
            tabPanels.length - 1
        );

        window.lucide?.createIcons?.();

        const card = $('.service-form-card');

        if (card) {
          const top =
            card.getBoundingClientRect().top +
            window.scrollY -
            82;

          if (window.scrollY > top + 160) {
            window.scrollTo({
              top,
              behavior: 'smooth'
            });
          }
        }
      }

      tabButtons.forEach(
        (button, idx) => {
          button.addEventListener(
            'click',
            () => {
              switchTab(idx);
            }
          );

          button.addEventListener(
            'keydown',
            (event) => {
              if (
                ![
                  'ArrowLeft',
                  'ArrowRight',
                  'Home',
                  'End'
                ].includes(event.key)
              ) {
                return;
              }

              event.preventDefault();

              let next = idx;

              if (
                event.key === 'ArrowLeft'
              ) {
                next = Math.max(
                  0,
                  idx - 1
                );
              }

              if (
                event.key === 'ArrowRight'
              ) {
                next = Math.min(
                  tabButtons.length - 1,
                  idx + 1
                );
              }

              if (event.key === 'Home') {
                next = 0;
              }

              if (event.key === 'End') {
                next =
                  tabButtons.length - 1;
              }

              tabButtons[next]?.focus();

              switchTab(next);
            }
          );
        }
      );

      btnPrevTab?.addEventListener(
        'click',
        () => {
          switchTab(
            activeTabIdx - 1,
            true
          );
        }
      );

      btnNextTab?.addEventListener(
        'click',
        () => {
          switchTab(activeTabIdx + 1);
        }
      );

      /* ================================================================
         SERVICE NUMBER
      ================================================================= */

      function generateNewServiceNo() {
        const year =
          new Date().getFullYear();

        const existingNumbers =
          serviceRecords
            .map((record) =>
              String(
                record.serviceNo || ''
              )
            )
            .filter((number) =>
              number.startsWith(
                `SR-${year}-`
              )
            )
            .map((number) =>
              Number(
                number
                  .split('-')
                  .pop()
              )
            )
            .filter(Number.isFinite);

        const next =
          existingNumbers.length
            ? Math.max(
                ...existingNumbers
              ) + 1
            : 1;

        return `SR-${year}-${String(
          next
        ).padStart(4, '0')}`;
      }

      /* ================================================================
         STATUS
      ================================================================= */

      function updateStatusBadge(
        status = 'Pending Review'
      ) {
        if (!displayStatusBadge) return;

        const normalized =
          status.toLowerCase();

        let type = 'warning';

        if (
          normalized.includes(
            'complete'
          ) ||
          normalized.includes('closed')
        ) {
          type = 'success';
        } else if (
          normalized.includes(
            'progress'
          ) ||
          normalized.includes(
            'assessed'
          ) ||
          normalized.includes(
            'evaluat'
          )
        ) {
          type = 'info';
        } else if (
          normalized.includes(
            'disapproved'
          ) ||
          normalized.includes('cancel')
        ) {
          type = 'danger';
        }

        displayStatusBadge.className =
          `badge-status ${type}`;

        displayStatusBadge.replaceChildren();

        const dot =
          document.createElement('span');

        dot.className = 'dot';

        displayStatusBadge.append(
          dot,
          document.createTextNode(
            ` ${status}`
          )
        );
      }

      /* ================================================================
         RESET FORM
      ================================================================= */

      function resetFormToNew({
        notify = true
      } = {}) {
        form.reset();

        if (hiddenDocId) {
          hiddenDocId.value = '';
        }

        const serviceNo =
          generateNewServiceNo();

        const serviceNoInput =
          $('#serviceNo');

        const dateRequest =
          $('#dateRequest');

        const serviceStatus =
          $('#serviceStatus');

        if (serviceNoInput) {
          serviceNoInput.value =
            serviceNo;
        }

        if (displayActiveId) {
          displayActiveId.textContent =
            serviceNo;
        }

        if (dateRequest) {
          dateRequest.value =
            new Date()
              .toISOString()
              .slice(0, 10);
        }

        if (serviceStatus) {
          serviceStatus.value =
            'Pending Review';
        }

        updateStatusBadge(
          'Pending Review'
        );

        $$('.field-error', form).forEach(
          (field) =>
            field.classList.remove(
              'field-error'
            )
        );

        switchTab(0, true);

        if (notify) {
          showToast(
            'New service request form is ready.',
            'success'
          );
        }
      }

      /* ================================================================
         WORKFLOW STEP
      ================================================================= */

      function calculateCurrentStep(
        status,
        data
      ) {
        if (
          String(
            data.serviceReceivedBy || ''
          ).trim()
        ) {
          return 5;
        }

        if (
          String(
            data.processedBy || ''
          ).trim()
        ) {
          return 4;
        }

        if (
          String(
            data.pgdhAction || ''
          ).trim()
        ) {
          return 3;
        }

        if (
          String(
            data.assessedBy || ''
          ).trim()
        ) {
          return 2;
        }

        const normalized =
          String(status || '')
            .toLowerCase();

        if (
          normalized.includes(
            'complete'
          ) ||
          normalized.includes('release')
        ) {
          return 5;
        }

        if (
          normalized.includes(
            'progress'
          ) ||
          normalized.includes(
            'process'
          ) ||
          normalized.includes(
            'rendered'
          )
        ) {
          return 4;
        }

        if (
          normalized.includes('pgdh') ||
          normalized.includes('approved')
        ) {
          return 3;
        }

        if (
          normalized.includes(
            'assessed'
          ) ||
          normalized.includes(
            'evaluat'
          )
        ) {
          return 2;
        }

        return 1;
      }

      /* ================================================================
         FORM DATA
      ================================================================= */

      function getFormData() {
        const values =
          new FormData(form);

        const data = {};

        values.forEach(
          (value, key) => {
            data[key] =
              typeof value === 'string'
                ? value.trim()
                : value;
          }
        );

        data.primaryCategory =
          data.technicalAssistance ||
          data.certifications ||
          data.plantingMaterials ||
          data.environmentalConcerns ||
          data.iecService ||
          'TECHNICAL ASSISTANCE';

        data.secondaryCategory =
          data.iecService ||
          data.certifications ||
          data.otherServices ||
          '--';

        data.concernsCategory =
          data.environmentalConcerns ||
          '--';

        data.endorsedBy =
          data.notedBy || '--';

        data.recDate =
          data.recommendedDate
            ? `${data.recommendedDate}${
                data.recommendedTime
                  ? ` • ${data.recommendedTime}`
                  : ''
              }`
            : '--';

        data.recRemarks =
          data.recommendedRemarks ||
          '--';

        data.pgdhDateActed =
          data.pgdhDateActed
            ? `${data.pgdhDateActed}${
                data.pgdhTimeActed
                  ? ` • ${data.pgdhTimeActed}`
                  : ''
              }`
            : '--';

        data.dateProcessed =
          data.dateProcessed
            ? `${data.dateProcessed}${
                data.timeProcessed
                  ? ` • ${data.timeProcessed}`
                  : ''
              }`
            : '--';

        data.finalDateRec =
          data.clientDateReceived ||
          data.clientDateActed
            ? `${
                data.clientDateReceived ||
                data.clientDateActed
              }${
                data.clientTimeReceived
                  ? ` • ${data.clientTimeReceived}`
                  : ''
              }`
            : '--';

        data.finalRemarks =
          data.clientRemarks || '--';

        data.currentStep =
          calculateCurrentStep(
            data.serviceStatus,
            data
          );

        data.updatedAt =
          new Date().toISOString();

        return data;
      }

      /* ================================================================
         LOAD RECORD INTO FORM
      ================================================================= */

      function populateForm(
        data,
        docId
      ) {
        form.reset();

        if (hiddenDocId) {
          hiddenDocId.value =
            docId || '';
        }

        Object.entries(
          data || {}
        ).forEach(
          ([key, value]) => {
            const field =
              form.elements.namedItem(
                key
              );

            if (
              !field ||
              value == null
            ) {
              return;
            }

            if ('value' in field) {
              field.value =
                String(value);
            }
          }
        );

        if (displayActiveId) {
          displayActiveId.textContent =
            data?.serviceNo ||
            'SR-RECORD';
        }

        updateStatusBadge(
          data?.serviceStatus ||
            'Pending Review'
        );

        switchTab(0, true);
      }

      $('#serviceStatus')
        ?.addEventListener(
          'change',
          (event) => {
            updateStatusBadge(
              event.target.value
            );
          }
        );

      $('#btnNewRecord')
        ?.addEventListener(
          'click',
          () => {
            resetFormToNew();
          }
        );

      $('#btnClearAction')
        ?.addEventListener(
          'click',
          () => {
            const confirmed =
              window.confirm(
                'Clear the current form and start a new service request?'
              );

            if (confirmed) {
              resetFormToNew();
            }
          }
        );

      /* ================================================================
         DATABASE
      ================================================================= */

      function initializeDatabase() {
        try {
          if (
            !window.firebase?.database
          ) {
            throw new Error(
              'Supabase compatibility layer is unavailable.'
            );
          }

          if (
            !window.firebase.apps?.length
          ) {
            window.firebase
              .initializeApp?.({});
          }

          db =
            window.firebase.database();

          serviceRequestsRef =
            db.ref(
              'service_requests'
            );

          return true;
        } catch (error) {
          console.error(
            'Service Request database initialization failed:',
            error
          );

          setDbStatus(
            false,
            'Database unavailable'
          );

          showToast(
            'Database is unavailable. The form can still be viewed, but records cannot be saved yet.',
            'error'
          );

          return false;
        }
      }

      /* ================================================================
         REALTIME DATABASE
      ================================================================= */

      function startRealtimeListeners() {
        if (
          !db ||
          !serviceRequestsRef
        ) {
          return;
        }

        db.ref(
          '.info/connected'
        ).on(
          'value',
          (snapshot) => {
            const online =
              snapshot.val() === true;

            setDbStatus(
              online,
              online
                ? 'Live Synchronized'
                : 'Connecting / Offline'
            );
          },
          (error) => {
            console.warn(
              'Connection status listener failed:',
              error
            );

            setDbStatus(
              false,
              'Sync unavailable'
            );
          }
        );

        serviceRequestsRef.on(
          'value',
          (snapshot) => {
            const raw =
              snapshot.val();

            serviceRecords = raw
              ? Object.entries(
                  raw
                ).map(
                  ([
                    key,
                    value
                  ]) => ({
                    id: key,
                    ...(value ||
                      {})
                  })
                )
              : [];

            serviceRecords.sort(
              (a, b) => {
                const aTime =
                  new Date(
                    a.updatedAt ||
                      a.dateRequest ||
                      a.createdAt ||
                      0
                  ).getTime();

                const bTime =
                  new Date(
                    b.updatedAt ||
                      b.dateRequest ||
                      b.createdAt ||
                      0
                  ).getTime();

                return bTime - aTime;
              }
            );

            const openCount =
              serviceRecords.filter(
                (item) => {
                  const status =
                    String(
                      item.serviceStatus ||
                        ''
                    ).toLowerCase();

                  return (
                    !status.includes(
                      'complete'
                    ) &&
                    !status.includes(
                      'closed'
                    ) &&
                    !status.includes(
                      'cancel'
                    )
                  );
                }
              ).length;

            const badge =
              $(
                '#sidebarOpenServicesBadge'
              );

            if (badge) {
              badge.textContent =
                `${openCount} Open`;
            }

            renderSummaryTable(
              serviceRecords
            );

            /*
             * Keep a fresh service number only when
             * the admin has not started entering data.
             */
            if (
              !hiddenDocId?.value &&
              !$('#clientName')?.value &&
              !$('#organization')
                ?.value
            ) {
              const nextNo =
                generateNewServiceNo();

              if ($('#serviceNo')) {
                $('#serviceNo').value =
                  nextNo;
              }

              if (displayActiveId) {
                displayActiveId.textContent =
                  nextNo;
              }
            }
          },
          (error) => {
            console.error(
              'Service request read error:',
              error
            );

            setDbStatus(
              false,
              'Sync Error'
            );

            showToast(
              error?.message ||
                'Unable to load service requests.',
              'error'
            );
          }
        );

        /*
         * Account request sidebar badge
         */
        try {
          db.ref(
            'access_requests'
          ).on(
            'value',
            (snapshot) => {
              const requests =
                snapshot.val() || {};

              const pending =
                Object.values(
                  requests
                ).filter(
                  (request) =>
                    String(
                      request?.status ||
                        ''
                    ).toLowerCase() ===
                    'pending'
                ).length;

              const badge =
                $(
                  '#sidebarPendingAccBadge'
                );

              if (badge) {
                badge.textContent =
                  `${pending} New`;
              }
            },
            (error) => {
              console.warn(
                'Account request badge could not be loaded:',
                error
              );
            }
          );
        } catch (error) {
          console.warn(
            'Account request badge listener failed:',
            error
          );
        }
      }

      /* ================================================================
         SAVE / UPDATE SERVICE REQUEST
      ================================================================= */

      form.addEventListener(
        'submit',
        async (event) => {
          event.preventDefault();

          if (!validateTab(0)) {
            switchTab(0, true);
            return;
          }

          if (!validateTab(1)) {
            switchTab(1, true);
            return;
          }

          if (!serviceRequestsRef) {
            showToast(
              'Database connection is not ready. Please check Supabase configuration.',
              'error'
            );

            return;
          }

          const record =
            getFormData();

          const docId =
            hiddenDocId?.value ||
            '';

          const originalMarkup =
            btnSaveAction?.innerHTML ||
            '';

          if (btnSaveAction) {
            btnSaveAction.disabled =
              true;

            btnSaveAction.innerHTML = `
              <i
                data-lucide="loader-2"
                class="spin-icon"
              ></i>

              <span>Saving...</span>
            `;

            window.lucide
              ?.createIcons?.();
          }

          try {
            /*
             * Existing record
             */
            if (docId) {
              await serviceRequestsRef
                .child(docId)
                .update(record);

              showToast(
                `Service request ${record.serviceNo} was updated.`,
                'success'
              );
            }

            /*
             * New record
             */
            else {
              record.createdAt =
                window.firebase
                  ?.database
                  ?.ServerValue
                  ?.TIMESTAMP ??
                new Date()
                  .toISOString();

              const newRef =
                serviceRequestsRef.push();

              record.id =
                newRef.key;

              await newRef.set(
                record
              );

              if (hiddenDocId) {
                hiddenDocId.value =
                  newRef.key;
              }

              showToast(
                `Service request ${record.serviceNo} was saved.`,
                'success'
              );
            }

            if (displayActiveId) {
              displayActiveId.textContent =
                record.serviceNo;
            }

            updateStatusBadge(
              record.serviceStatus
            );
          } catch (error) {
            console.error(
              'Service request save failed:',
              error
            );

            showToast(
              error?.message ||
                'Unable to save this service request.',
              'error'
            );
          } finally {
            if (btnSaveAction) {
              btnSaveAction.disabled =
                false;

              btnSaveAction.innerHTML =
                originalMarkup ||
                `
                  <i data-lucide="save"></i>
                  <span>SAVE RECORD</span>
                `;

              window.lucide
                ?.createIcons?.();
            }
          }
        }
      );

      /* ================================================================
         MODALS
      ================================================================= */

      function openModal(modal) {
        if (!modal) return;

        modal.classList.add('open');

        modal.setAttribute(
          'aria-hidden',
          'false'
        );

        document.body.classList.add(
          'service-modal-open'
        );
      }

      function closeModal(modal) {
        if (!modal) return;

        modal.classList.remove('open');

        modal.setAttribute(
          'aria-hidden',
          'true'
        );

        if (
          !summaryModal?.classList.contains(
            'open'
          ) &&
          !searchModal?.classList.contains(
            'open'
          )
        ) {
          document.body.classList.remove(
            'service-modal-open'
          );
        }
      }

      $('#btnOpenSummaryModal')
        ?.addEventListener(
          'click',
          () => {
            openModal(
              summaryModal
            );
          }
        );

      $('#closeSummaryModal')
        ?.addEventListener(
          'click',
          () => {
            closeModal(
              summaryModal
            );
          }
        );

      $('#btnOpenSearchModal')
        ?.addEventListener(
          'click',
          () => {
            renderSearchModalResults(
              serviceRecords
            );

            openModal(
              searchModal
            );

            window.setTimeout(
              () => {
                modalSearchFilter?.focus();
              },
              50
            );
          }
        );

      $('#closeSearchModal')
        ?.addEventListener(
          'click',
          () => {
            closeModal(
              searchModal
            );
          }
        );

      [
        summaryModal,
        searchModal
      ].forEach((modal) => {
        modal?.addEventListener(
          'click',
          (event) => {
            if (
              event.target === modal
            ) {
              closeModal(modal);
            }
          }
        );
      });

      /* ================================================================
         KEYBOARD
      ================================================================= */

      document.addEventListener(
        'keydown',
        (event) => {
          /*
           * Escape closes modal
           */
          if (
            event.key === 'Escape'
          ) {
            closeModal(
              summaryModal
            );

            closeModal(
              searchModal
            );
          }

          /*
           * Ctrl + K / Cmd + K
           */
          if (
            (event.ctrlKey ||
              event.metaKey) &&
            event.key.toLowerCase() ===
              'k'
          ) {
            event.preventDefault();

            quickSearchInput?.focus();
            quickSearchInput?.select?.();
          }
        }
      );

      /* ================================================================
         SEARCH
      ================================================================= */

      function matchesRecord(
        record,
        term
      ) {
        if (!term) return true;

        return [
          record.serviceNo,
          record.clientName,
          record.organization,
          record.location
        ].some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(term)
        );
      }

      modalSearchFilter
        ?.addEventListener(
          'input',
          (event) => {
            const term =
              event.target.value
                .toLowerCase()
                .trim();

            renderSearchModalResults(
              serviceRecords.filter(
                (record) =>
                  matchesRecord(
                    record,
                    term
                  )
              )
            );
          }
        );

      quickSearchInput
        ?.addEventListener(
          'keydown',
          (event) => {
            if (
              event.key !== 'Enter'
            ) {
              return;
            }

            event.preventDefault();

            const term =
              quickSearchInput.value
                .toLowerCase()
                .trim();

            if (!term) return;

            const record =
              serviceRecords.find(
                (item) =>
                  matchesRecord(
                    item,
                    term
                  )
              );

            if (!record) {
              showToast(
                `No service request matched “${quickSearchInput.value}”.`,
                'error'
              );

              return;
            }

            populateForm(
              record,
              record.id
            );

            showToast(
              `${record.serviceNo || 'Service request'} loaded.`,
              'success'
            );
          }
        );

      /* ================================================================
         STATUS CLASS
      ================================================================= */

      function statusClass(status) {
        const value =
          String(status || '')
            .toLowerCase();

        if (
          value.includes(
            'complete'
          ) ||
          value.includes('closed')
        ) {
          return 'success';
        }

        if (
          value.includes('cancel') ||
          value.includes(
            'disapproved'
          )
        ) {
          return 'danger';
        }

        if (
          value.includes('pending') ||
          value.includes('review')
        ) {
          return 'warning';
        }

        return 'info';
      }

      /* ================================================================
         SEARCH RESULTS
      ================================================================= */

      function renderSearchModalResults(
        list
      ) {
        const tbody =
          $(
            '#searchModalResultsBody'
          );

        if (!tbody) return;

        if (!list.length) {
          tbody.innerHTML = `
            <tr>
              <td
                colspan="6"
                class="empty-table-cell"
              >
                No matching service requests found.
              </td>
            </tr>
          `;

          return;
        }

        tbody.innerHTML =
          list
            .map(
              (item) => `
                <tr>
                  <td>
                    <strong>
                      ${escapeHtml(
                        item.serviceNo ||
                          '--'
                      )}
                    </strong>
                  </td>

                  <td>
                    ${escapeHtml(
                      item.clientName ||
                        '--'
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      item.organization ||
                        '--'
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      item.dateRequest ||
                        '--'
                    )}
                  </td>

                  <td>
                    <span
                      class="badge-status ${statusClass(
                        item.serviceStatus
                      )}"
                    >
                      ${escapeHtml(
                        item.serviceStatus ||
                          'Pending'
                      )}
                    </span>
                  </td>

                  <td
                    class="table-action-cell"
                  >
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm js-load-record"
                      data-record-id="${escapeHtml(
                        item.id
                      )}"
                    >
                      Load
                    </button>
                  </td>
                </tr>
              `
            )
            .join('');
      }

      /* ================================================================
         SUMMARY TABLE
      ================================================================= */

      function renderSummaryTable(
        list
      ) {
        const tbody =
          $('#summaryMasterBody');

        const label =
          $('#summaryCountLabel');

        if (label) {
          label.textContent = `${
            list.length
          } service record${
            list.length === 1
              ? ''
              : 's'
          } in database`;
        }

        if (!tbody) return;

        if (!list.length) {
          tbody.innerHTML = `
            <tr>
              <td
                colspan="7"
                class="empty-table-cell"
              >
                No service records registered yet.
              </td>
            </tr>
          `;

          renderSearchModalResults(
            []
          );

          return;
        }

        tbody.innerHTML =
          list
            .map((item) => {
              const scope =
                item.primaryCategory ||
                item.technicalAssistance ||
                item.plantingMaterials ||
                item.certifications ||
                'General Service';

              return `
                <tr>
                  <td>
                    <strong
                      class="service-number-text"
                    >
                      ${escapeHtml(
                        item.serviceNo ||
                          '--'
                      )}
                    </strong>
                  </td>

                  <td>
                    ${escapeHtml(
                      item.dateRequest ||
                        '--'
                    )}
                  </td>

                  <td>
                    <strong>
                      ${escapeHtml(
                        item.clientName ||
                          'N/A'
                      )}
                    </strong>
                  </td>

                  <td>
                    ${escapeHtml(
                      item.organization ||
                        '--'
                    )}
                  </td>

                  <td>
                    <span
                      class="scope-text"
                    >
                      ${escapeHtml(
                        scope
                      )}
                    </span>
                  </td>

                  <td>
                    <span
                      class="badge-status ${statusClass(
                        item.serviceStatus
                      )}"
                    >
                      ${escapeHtml(
                        item.serviceStatus ||
                          'Pending'
                      )}
                    </span>
                  </td>

                  <td
                    class="table-action-cell"
                  >
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm js-load-record"
                      data-record-id="${escapeHtml(
                        item.id
                      )}"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              `;
            })
            .join('');

        renderSearchModalResults(
          list
        );
      }

      /* ================================================================
         EDIT / LOAD RECORD
      ================================================================= */

      document.addEventListener(
        'click',
        (event) => {
          const button =
            event.target.closest(
              '.js-load-record'
            );

          if (!button) return;

          const record =
            serviceRecords.find(
              (item) =>
                String(item.id) ===
                String(
                  button.dataset
                    .recordId
                )
            );

          if (!record) return;

          populateForm(
            record,
            record.id
          );

          closeModal(
            summaryModal
          );

          closeModal(
            searchModal
          );

          showToast(
            `${record.serviceNo || 'Service request'} loaded successfully.`,
            'success'
          );
        }
      );

      /* ================================================================
         CSV EXPORT
      ================================================================= */

      $('#btnExportSummaryCsv')
        ?.addEventListener(
          'click',
          () => {
            if (
              !serviceRecords.length
            ) {
              showToast(
                'There are no service records to export.',
                'warning'
              );

              return;
            }

            const csvCell =
              (value) =>
                `"${String(
                  value ?? ''
                ).replaceAll(
                  '"',
                  '""'
                )}"`;

            const headers = [
              'Service No',
              'Date Requested',
              'Client Name',
              'Organization',
              'Contact No',
              'Status',
              'Location',
              'Current Step'
            ];

            const rows =
              serviceRecords.map(
                (record) =>
                  [
                    record.serviceNo,
                    record.dateRequest,
                    record.clientName,
                    record.organization,
                    record.contactNo,
                    record.serviceStatus,
                    record.location,
                    record.currentStep ||
                      1
                  ]
                    .map(csvCell)
                    .join(',')
              );

            const blob =
              new Blob(
                [
                  [
                    headers
                      .map(csvCell)
                      .join(','),
                    ...rows
                  ].join('\n')
                ],
                {
                  type: 'text/csv;charset=utf-8'
                }
              );

            const url =
              URL.createObjectURL(
                blob
              );

            const link =
              document.createElement(
                'a'
              );

            link.href = url;

            link.download =
              `PGENRO_Service_Requests_${new Date()
                .toISOString()
                .slice(
                  0,
                  10
                )}.csv`;

            document.body.appendChild(
              link
            );

            link.click();

            link.remove();

            URL.revokeObjectURL(
              url
            );
          }
        );

      /* ================================================================
         REMOVE VALIDATION ERROR WHEN USER TYPES
      ================================================================= */

      form.addEventListener(
        'input',
        (event) => {
          event.target?.classList?.remove(
            'field-error'
          );
        }
      );

      form.addEventListener(
        'change',
        (event) => {
          event.target?.classList?.remove(
            'field-error'
          );
        }
      );

      /* ================================================================
         INITIAL LOAD
      ================================================================= */

      resetFormToNew({
        notify: false
      });

      if (initializeDatabase()) {
        startRealtimeListeners();
      }
    },
    {
      once: true
    }
  );
})();