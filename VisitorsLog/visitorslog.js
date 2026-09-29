(() => {
  "use strict";

  const CONFIG = Object.freeze({
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP",
    table: "visitors"
  });

  const db = typeof window.supabase?.createClient === "function"
    ? window.supabase.createClient(CONFIG.url, CONFIG.publishableKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      })
    : null;

  document.addEventListener("DOMContentLoaded", init, { once: true });

  function init() {
    const form = document.getElementById("visitorForm");
    if (!form) return;

    const $ = (id) => document.getElementById(id);

    const ui = {
      form,
      inputs: [...form.querySelectorAll("input, select, textarea")],

      fullName: $("fullName"),
      contact: $("contact"),
      address: $("address"),
      personToVisit: $("personToVisit"),
      purposeCategory: $("purposeCategory"),
      otherPurposeGroup: $("otherPurposeGroup"),
      otherPurposeSpecific: $("otherPurposeSpecific"),

      progressBar: $("progressBar"),
      progressPercent: $("progressPercent"),
      progressText: $("progressText"),
      progressCount: $("progressCount"),

      submitBtn: $("submitBtn"),
      formContainer: $("visitorCard"),

      connection: $("dbConnectionStatus"),

      modal: $("successModal"),
      closeModalBtn: $("closeModalBtn"),
      visitorNameDisplay: $("visitorNameDisplay"),

      toastStack: $("toastStack")
    };

    const state = {
      isSubmitting: false,
      activeSkyClass: "day",
      modalReturnFocus: null,
      lastSubmissionAt: 0,
      resizeTimer: null,
      lastMobileState: window.innerWidth <= 700
    };

    function cleanText(value) {
      return String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function setConnectionStatus(mode, label) {
      if (!ui.connection) return;

      ui.connection.classList.remove(
        "is-ready",
        "is-offline",
        "is-saving"
      );

      ui.connection.classList.add(
        mode === "offline"
          ? "is-offline"
          : mode === "saving"
            ? "is-saving"
            : "is-ready"
      );

      const labelEl =
        ui.connection.querySelector(".connection-label");

      if (labelEl) {
        labelEl.textContent = label;
      }
    }

    function syncNetworkStatus() {
      if (!navigator.onLine) {
        setConnectionStatus(
          "offline",
          "Internet connection unavailable"
        );

        return;
      }

      if (!db) {
        setConnectionStatus(
          "offline",
          "Registration service unavailable"
        );

        return;
      }

      if (!state.isSubmitting) {
        setConnectionStatus(
          "ready",
          "Ready to register"
        );
      }
    }

    function isGroupVisible(group) {
      if (!group) return false;

      if (group === ui.otherPurposeGroup) {
        return group.classList.contains("is-open");
      }

      return true;
    }

    function getGroup(input) {
      return input?.closest(".input-group") || null;
    }

    function fieldIsValid(input) {
      const group = getGroup(input);

      if (!group || !isGroupVisible(group)) {
        return true;
      }

      const value = cleanText(input.value);

      if (input.required && !value) {
        return false;
      }

      if (!value && !input.required) {
        return true;
      }

      if (input.id === "contact") {
        return /^09\d{9}$/.test(value);
      }

      if (input.id === "fullName") {
        return value.length >= 2;
      }

      if (input.id === "address") {
        return value.length >= 3;
      }

      if (input.id === "personToVisit") {
        return value.length >= 2;
      }

      if (input.id === "otherPurposeSpecific") {
        return !input.required || value.length >= 2;
      }

      return true;
    }

    function setFieldState(input, fieldState, message = "") {
      const group = getGroup(input);

      if (!group) return;

      group.classList.remove(
        "error",
        "success"
      );

      if (fieldState) {
        group.classList.add(fieldState);
      }

      const messageEl =
        group.querySelector(".error-msg");

      if (messageEl) {
        messageEl.textContent = message;
      }

      input.setAttribute(
        "aria-invalid",
        fieldState === "error"
          ? "true"
          : "false"
      );
    }

    function getFieldLabel(input) {
      const label =
        getGroup(input)?.querySelector("label");

      return (
        cleanText(
          label?.textContent?.replaceAll("'", "")
        ) ||
        "This field"
      );
    }

    function validateField(
      input,
      { silent = false } = {}
    ) {
      const group = getGroup(input);

      if (!group || !isGroupVisible(group)) {
        return true;
      }

      const value = cleanText(input.value);

      let message = "";

      if (input.required && !value) {
        message =
          input.id === "purposeCategory"
            ? "Please select a purpose category."
            : `${getFieldLabel(input)} is required.`;
      } else if (
        input.id === "contact" &&
        !/^09\d{9}$/.test(value)
      ) {
        message =
          "Enter an 11-digit mobile number starting with 09.";
      } else if (
        input.id === "fullName" &&
        value.length < 2
      ) {
        message =
          "Please enter your complete name.";
      } else if (
        input.id === "address" &&
        value.length < 3
      ) {
        message =
          "Please enter your address, agency, or office.";
      } else if (
        input.id === "personToVisit" &&
        value.length < 2
      ) {
        message =
          "Please enter the person or department you are visiting.";
      } else if (
        input.id === "otherPurposeSpecific" &&
        input.required &&
        value.length < 2
      ) {
        message =
          "Please specify your purpose.";
      }

      if (message) {
        if (!silent) {
          setFieldState(
            input,
            "error",
            message
          );
        }

        return false;
      }

      if (!silent) {
        if (value) {
          setFieldState(
            input,
            "success"
          );
        } else {
          setFieldState(
            input,
            ""
          );
        }
      }

      return true;
    }

    function getActiveRequiredInputs() {
      return ui.inputs.filter((input) => {
        const group =
          getGroup(input);

        return Boolean(
          input.required &&
          group &&
          isGroupVisible(group)
        );
      });
    }

    function updateProgress() {
      const requiredInputs =
        getActiveRequiredInputs();

      const completed =
        requiredInputs.filter(
          fieldIsValid
        ).length;

      const total =
        requiredInputs.length || 1;

      const percent =
        Math.round(
          (completed / total) * 100
        );

      if (ui.progressBar) {
        ui.progressBar.style.width =
          `${percent}%`;
      }

      if (ui.progressPercent) {
        ui.progressPercent.textContent =
          `${percent}%`;
      }

      if (ui.progressCount) {
        ui.progressCount.textContent =
          `${completed} / ${requiredInputs.length} fields`;
      }

      if (ui.progressText) {
        if (percent === 0) {
          ui.progressText.textContent =
            "Start your visitor entry";
        } else if (percent < 50) {
          ui.progressText.textContent =
            "Good start — keep going";
        } else if (percent < 100) {
          ui.progressText.textContent =
            "Almost ready to submit";
        } else {
          ui.progressText.textContent =
            "Ready to submit";
        }
      }

      ui.formContainer?.classList.toggle(
        "form-complete",
        percent === 100
      );
    }

    function showToast(
      message,
      type = "error"
    ) {
      if (!ui.toastStack) return;

      const toast =
        document.createElement("div");

      toast.className =
        `toast toast-${type}`;

      toast.setAttribute(
        "role",
        type === "error"
          ? "alert"
          : "status"
      );

      toast.innerHTML = `
        <span class="toast-dot" aria-hidden="true"></span>

        <div class="toast-copy">
          <strong></strong>
          <span></span>
        </div>

        <button
          class="toast-close"
          type="button"
          aria-label="Dismiss notification"
        >
          ×
        </button>
      `;

      const title =
        toast.querySelector(
          ".toast-copy strong"
        );

      const body =
        toast.querySelector(
          ".toast-copy span"
        );

      if (title) {
        title.textContent =
          type === "error"
            ? "Unable to continue"
            : type === "success"
              ? "Registration update"
              : "Notice";
      }

      if (body) {
        body.textContent = message;
      }

      toast
        .querySelector(".toast-close")
        ?.addEventListener(
          "click",
          () => dismissToast(toast)
        );

      ui.toastStack.appendChild(toast);

      requestAnimationFrame(() => {
        toast.classList.add("show");
      });

      window.setTimeout(
        () => dismissToast(toast),
        5200
      );
    }

    function dismissToast(toast) {
      if (
        !toast ||
        toast.dataset.closing === "true"
      ) {
        return;
      }

      toast.dataset.closing = "true";

      toast.classList.remove("show");

      window.setTimeout(() => {
        toast.remove();
      }, 260);
    }

    function setSubmitting(submitting) {
      state.isSubmitting =
        submitting;

      if (!ui.submitBtn) return;

      ui.submitBtn.disabled =
        submitting;

      ui.submitBtn.classList.toggle(
        "is-loading",
        submitting
      );

      ui.submitBtn.setAttribute(
        "aria-busy",
        submitting
          ? "true"
          : "false"
      );

      const label =
        ui.submitBtn.querySelector(
          ".submit-btn-label"
        );

      if (label) {
        label.textContent =
          submitting
            ? "Saving Entry..."
            : "Submit Entry Log";
      }

      if (submitting) {
        setConnectionStatus(
          "saving",
          "Saving visitor entry…"
        );
      } else {
        syncNetworkStatus();
      }
    }

    function focusFirstInvalid() {
      const firstInvalid =
        getActiveRequiredInputs().find(
          (input) =>
            !fieldIsValid(input)
        );

      if (!firstInvalid) return;

      firstInvalid.focus({
        preventScroll: true
      });

      firstInvalid
        .closest(".input-group")
        ?.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
    }

    function syncOtherPurpose() {
      if (
        !ui.purposeCategory ||
        !ui.otherPurposeGroup ||
        !ui.otherPurposeSpecific
      ) {
        return;
      }

      const isOther =
        lowerPurpose(
          ui.purposeCategory.value
        ).includes("other");

      ui.otherPurposeGroup.classList.toggle(
        "is-open",
        isOther
      );

      ui.otherPurposeGroup.setAttribute(
        "aria-hidden",
        isOther
          ? "false"
          : "true"
      );

      ui.otherPurposeSpecific.required =
        isOther;

      ui.otherPurposeSpecific.tabIndex =
        isOther
          ? 0
          : -1;

      if (!isOther) {
        ui.otherPurposeSpecific.value =
          "";

        setFieldState(
          ui.otherPurposeSpecific,
          ""
        );
      }

      updateProgress();
    }

    function lowerPurpose(value) {
      return cleanText(
        value
      ).toLowerCase();
    }

    function normalizeContactInput() {
      if (!ui.contact) return;

      ui.contact.value =
        ui.contact.value
          .replace(/\D/g, "")
          .slice(0, 11);
    }

    function bindFieldEvents() {
      ui.purposeCategory
        ?.addEventListener(
          "change",
          syncOtherPurpose
        );

      ui.inputs.forEach((input) => {
        input.addEventListener(
          "input",
          () => {
            if (
              input.id === "contact"
            ) {
              normalizeContactInput();
            }

            const group =
              getGroup(input);

            if (
              group?.classList.contains(
                "error"
              )
            ) {
              validateField(input);
            } else if (
              fieldIsValid(input) &&
              cleanText(input.value)
            ) {
              setFieldState(
                input,
                "success"
              );
            } else if (
              !cleanText(input.value)
            ) {
              setFieldState(
                input,
                ""
              );
            }

            updateProgress();
          }
        );

        input.addEventListener(
          "change",
          () => {
            validateField(input);

            updateProgress();
          }
        );

        input.addEventListener(
          "blur",
          () => {
            if (
              cleanText(input.value) ||
              input.required
            ) {
              validateField(input);
            }
          }
        );
      });
    }

    function initClock() {
      const todayDateEl =
        $("todayDate");

      const timeHour =
        $("timeHour");

      const timeMinute =
        $("timeMinute");

      const timeSecond =
        $("timeSecond");

      const timeAmpm =
        $("timeAmpm");

      const secHand =
        $("secHand");

      const minHand =
        $("minHand");

      const hourHand =
        $("hourHand");

      const sky =
        $("sky-background");

      const celestial =
        $("celestialBody");

      function updateClockAndSky() {
        const now =
          new Date();

        const hours =
          now.getHours();

        const minutes =
          now.getMinutes();

        const seconds =
          now.getSeconds();

        const displayHours =
          hours % 12 || 12;

        const ampm =
          hours >= 12
            ? "PM"
            : "AM";

        if (todayDateEl) {
          todayDateEl.textContent =
            now
              .toLocaleDateString(
                "en-PH",
                {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric"
                }
              )
              .toUpperCase();
        }

        if (timeHour) {
          timeHour.textContent =
            String(
              displayHours
            ).padStart(2, "0");
        }

        if (timeMinute) {
          timeMinute.textContent =
            String(
              minutes
            ).padStart(2, "0");
        }

        if (timeSecond) {
          timeSecond.textContent =
            String(
              seconds
            ).padStart(2, "0");
        }

        if (timeAmpm) {
          timeAmpm.textContent =
            ampm;
        }

        if (secHand) {
          secHand.style.transform =
            `rotate(${seconds * 6}deg)`;
        }

        if (minHand) {
          minHand.style.transform =
            `rotate(${
              minutes * 6 +
              seconds * 0.1
            }deg)`;
        }

        if (hourHand) {
          hourHand.style.transform =
            `rotate(${
              (hours % 12) * 30 +
              minutes * 0.5
            }deg)`;
        }

        const timeDecimal =
          hours +
          minutes / 60 +
          seconds / 3600;

        let currentClass =
          "night";

        if (
          timeDecimal >= 5 &&
          timeDecimal < 9
        ) {
          currentClass =
            "morning";
        } else if (
          timeDecimal >= 9 &&
          timeDecimal < 16
        ) {
          currentClass =
            "day";
        } else if (
          timeDecimal >= 16 &&
          timeDecimal < 18.5
        ) {
          currentClass =
            "sunset";
        }

        if (
          sky &&
          !sky.classList.contains(
            currentClass
          )
        ) {
          sky.classList.remove(
            "morning",
            "day",
            "sunset",
            "night"
          );

          sky.classList.add(
            currentClass
          );

          updateLeavesTheme(
            currentClass
          );
        } else {
          state.activeSkyClass =
            currentClass;
        }

        if (celestial) {
          let progress;

          if (
            timeDecimal >= 6 &&
            timeDecimal <= 18
          ) {
            progress =
              (timeDecimal - 6) /
              12;
          } else {
            const nightTime =
              timeDecimal > 18
                ? timeDecimal - 18
                : timeDecimal + 6;

            progress =
              nightTime / 12;
          }

          progress =
            Math.max(
              0,
              Math.min(
                1,
                progress
              )
            );

          const x =
            7 +
            progress * 86;

          const y =
            77 -
            Math.sin(
              progress *
              Math.PI
            ) *
              62;

          celestial.style.left =
            `${x}%`;

          celestial.style.top =
            `${y}%`;
        }
      }

      updateClockAndSky();

      window.setInterval(
        updateClockAndSky,
        1000
      );
    }

    function createLeaves() {
      const container =
        $("leaves-container");

      if (!container) return;

      if (
        window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches
      ) {
        container.replaceChildren();
        return;
      }

      const isMobile =
        window.innerWidth <= 700;

      const leafCount =
        isMobile
          ? 9
          : 22;

      const fragment =
        document.createDocumentFragment();

      for (
        let i = 0;
        i < leafCount;
        i += 1
      ) {
        const leaf =
          document.createElement("span");

        leaf.className =
          `leaf leaf-type-${
            (i % 3) + 1
          }`;

        leaf.dataset.skyTheme =
          state.activeSkyClass;

        const fallDuration =
          (isMobile ? 12 : 14) +
          Math.random() *
            (isMobile ? 7 : 10);

        const size =
          (isMobile ? 11 : 12) +
          Math.random() *
            (isMobile ? 10 : 14);

        const drift =
          (
            Math.random() > 0.5
              ? 1
              : -1
          ) *
          (
            (isMobile ? 40 : 55) +
            Math.random() *
              (isMobile ? 110 : 170)
          );

        const leftStart =
          Math.random() * 108 - 4;

        const opacity =
          0.22 +
          Math.random() * 0.38;

        const scale =
          0.72 +
          Math.random() * 0.55;

        const spinDuration =
          3.8 +
          Math.random() * 3.6;

        const flutterDuration =
          2.2 +
          Math.random() * 2.6;

        const blur =
          Math.random() > 0.78
            ? `${
                0.4 +
                Math.random() * 0.8
              }px`
            : "0px";

        const tilt =
          `${
            -18 +
            Math.random() * 36
          }deg`;

        const vein =
          `${
            -10 +
            Math.random() * 20
          }deg`;

        leaf.style.left =
          `${leftStart}vw`;

        leaf.style.setProperty(
          "--leaf-size",
          `${size}px`
        );

        leaf.style.setProperty(
          "--fall-duration",
          `${fallDuration}s`
        );

        leaf.style.setProperty(
          "--fall-delay",
          `${
            -(
              Math.random() *
              fallDuration
            )
          }s`
        );

        leaf.style.setProperty(
          "--flutter-duration",
          `${flutterDuration}s`
        );

        leaf.style.setProperty(
          "--spin-duration",
          `${spinDuration}s`
        );

        leaf.style.setProperty(
          "--leaf-drift",
          `${drift}px`
        );

        leaf.style.setProperty(
          "--leaf-opacity",
          `${opacity}`
        );

        leaf.style.setProperty(
          "--leaf-scale",
          `${scale}`
        );

        leaf.style.setProperty(
          "--leaf-blur",
          blur
        );

        leaf.style.setProperty(
          "--leaf-tilt",
          tilt
        );

        leaf.style.setProperty(
          "--leaf-vein",
          vein
        );

        fragment.appendChild(
          leaf
        );
      }

      container.replaceChildren(
        fragment
      );
    }

    function updateLeavesTheme(theme) {
      state.activeSkyClass =
        theme;

      document
        .querySelectorAll(".leaf")
        .forEach((leaf) => {
          leaf.dataset.skyTheme =
            theme;
        });
    }

    function bindAmbientEffects() {
      window.addEventListener(
        "resize",
        () => {
          window.clearTimeout(
            state.resizeTimer
          );

          state.resizeTimer =
            window.setTimeout(
              () => {
                const mobileState =
                  window.innerWidth <=
                  700;

                if (
                  mobileState !==
                  state.lastMobileState
                ) {
                  state.lastMobileState =
                    mobileState;

                  createLeaves();
                }
              },
              180
            );
        }
      );

      if (
        ui.formContainer &&
        !window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches
      ) {
        ui.formContainer.addEventListener(
          "pointermove",
          (event) => {
            const rect =
              ui.formContainer
                .getBoundingClientRect();

            const x =
              (
                (
                  event.clientX -
                  rect.left
                ) /
                rect.width
              ) *
              100;

            const y =
              (
                (
                  event.clientY -
                  rect.top
                ) /
                rect.height
              ) *
              100;

            ui.formContainer.style.setProperty(
              "--pointer-x",
              `${x}%`
            );

            ui.formContainer.style.setProperty(
              "--pointer-y",
              `${y}%`
            );
          }
        );
      }
    }

    function getModalFocusable() {
      if (!ui.modal) {
        return [];
      }

      return [
        ...ui.modal.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ];
    }

    function openModal() {
      if (!ui.modal) return;

      state.modalReturnFocus =
        document.activeElement;

      ui.modal.classList.add(
        "show"
      );

      ui.modal.setAttribute(
        "aria-hidden",
        "false"
      );

      document.body.classList.add(
        "modal-open"
      );

      window.setTimeout(() => {
        ui.modal
          ?.querySelector(
            ".modal-content"
          )
          ?.focus();
      }, 60);
    }

    function closeModal() {
      if (
        !ui.modal ||
        !ui.modal.classList.contains(
          "show"
        )
      ) {
        return;
      }

      ui.modal.classList.add(
        "modal-leaving"
      );

      window.setTimeout(() => {
        ui.modal.classList.remove(
          "show",
          "modal-leaving"
        );

        ui.modal.setAttribute(
          "aria-hidden",
          "true"
        );

        document.body.classList.remove(
          "modal-open"
        );

        state.modalReturnFocus
          ?.focus?.();
      }, 240);
    }

    function bindModal() {
      ui.closeModalBtn
        ?.addEventListener(
          "click",
          closeModal
        );

      ui.modal
        ?.addEventListener(
          "click",
          (event) => {
            if (
              event.target ===
              ui.modal
            ) {
              closeModal();
            }
          }
        );

      document.addEventListener(
        "keydown",
        (event) => {
          if (
            !ui.modal
              ?.classList
              .contains("show")
          ) {
            return;
          }

          if (
            event.key === "Escape"
          ) {
            event.preventDefault();

            closeModal();

            return;
          }

          if (
            event.key !== "Tab"
          ) {
            return;
          }

          const focusable =
            getModalFocusable();

          if (!focusable.length) {
            event.preventDefault();
            return;
          }

          const first =
            focusable[0];

          const last =
            focusable[
              focusable.length - 1
            ];

          if (
            event.shiftKey &&
            document.activeElement ===
              first
          ) {
            event.preventDefault();

            last.focus();
          } else if (
            !event.shiftKey &&
            document.activeElement ===
              last
          ) {
            event.preventDefault();

            first.focus();
          }
        }
      );
    }

    function buildVisitorData() {
      return {
        full_name:
          cleanText(
            ui.fullName?.value
          ),

        contact:
          cleanText(
            ui.contact?.value
          ),

        address:
          cleanText(
            ui.address?.value
          ),

        person_to_visit:
          cleanText(
            ui.personToVisit?.value
          ),

        purpose_category:
          cleanText(
            ui.purposeCategory?.value
          ),

        other_purpose_specific:
          cleanText(
            ui.otherPurposeSpecific?.value
          )
      };
    }

    async function submitVisitor(event) {
      event.preventDefault();

      if (state.isSubmitting) {
        return;
      }

      let valid = true;

      getActiveRequiredInputs()
        .forEach((input) => {
          if (
            !validateField(input)
          ) {
            valid = false;
          }
        });

      updateProgress();

      if (!valid) {
        ui.formContainer
          ?.classList
          .remove(
            "shake-effect"
          );

        void ui.formContainer
          ?.offsetWidth;

        ui.formContainer
          ?.classList
          .add(
            "shake-effect"
          );

        focusFirstInvalid();

        showToast(
          "Please complete the highlighted fields before submitting.",
          "error"
        );

        return;
      }

      if (!navigator.onLine) {
        syncNetworkStatus();

        showToast(
          "You appear to be offline. Reconnect to the internet, then submit again.",
          "error"
        );

        return;
      }

      if (!db) {
        setConnectionStatus(
          "offline",
          "Registration service unavailable"
        );

        showToast(
          "The visitor database could not be initialized. Please contact the front desk.",
          "error"
        );

        return;
      }

      const now =
        Date.now();

      if (
        now -
          state.lastSubmissionAt <
        1800
      ) {
        return;
      }

      state.lastSubmissionAt =
        now;

      const visitorData =
        buildVisitorData();

      setSubmitting(true);

      try {
        const { error } =
          await db
            .from(
              CONFIG.table
            )
            .insert([
              visitorData
            ]);

        if (error) {
          throw error;
        }

        if (
          ui.visitorNameDisplay
        ) {
          ui.visitorNameDisplay.textContent =
            visitorData
              .full_name
              .split(/\s+/)[0] ||
            "Visitor";
        }

        form.reset();

        ui.inputs.forEach(
          (input) => {
            setFieldState(
              input,
              ""
            );
          }
        );

        syncOtherPurpose();

        updateProgress();

        setConnectionStatus(
          "ready",
          "Entry saved successfully"
        );

        openModal();

      } catch (error) {
        console.error(
          "Unable to save visitor entry:",
          error
        );

        const message =
          error?.code === "23502"
            ? "The visitor database is missing a required default value. Please contact the administrator."
            : error?.code === "42501"
              ? "Visitor registration is not permitted by the current database policy. Please contact the administrator."
              : error?.message
                  ?.toLowerCase()
                  .includes("fetch")
                ? "The registration service could not be reached. Check the connection and try again."
                : "Your entry could not be saved. Please try again.";

        setConnectionStatus(
          "offline",
          "Unable to save entry"
        );

        showToast(
          message,
          "error"
        );

      } finally {
        setSubmitting(false);
      }
    }

    function boot() {
      bindFieldEvents();

      bindModal();

      bindAmbientEffects();

      form.addEventListener(
        "submit",
        submitVisitor
      );

      window.addEventListener(
        "online",
        syncNetworkStatus
      );

      window.addEventListener(
        "offline",
        syncNetworkStatus
      );

      syncOtherPurpose();

      initClock();

      createLeaves();

      updateProgress();

      syncNetworkStatus();
    }

    boot();
  }
})();