/* ==========================================================================
   PGENRO IMS — ADMIN COMMUNICATIONS LOG
   Smart OCR parser: extracts source office from letterhead, recipient from TO,
   subject from SUBJECT, control number, document type, and date.
   ========================================================================== */

(() => {
  "use strict";

  if (window.PGENRO_COMMUNICATION_INITIALIZED) return;
  window.PGENRO_COMMUNICATION_INITIALIZED = true;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();

  async function init() {
    /* ---------------- 1. HELPERS & ICON RESOLVER ---------------- */
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[character]);
    }

    const iconNodes = {"panel-left-close":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}],["path",{"d":"m16 15-3-3 3-3"}]],"layout-dashboard":[["rect",{"width":"7","height":"9","x":"3","y":"3","rx":"1"}],["rect",{"width":"7","height":"5","x":"14","y":"3","rx":"1"}],["rect",{"width":"7","height":"9","x":"14","y":"12","rx":"1"}],["rect",{"width":"7","height":"5","x":"3","y":"16","rx":"1"}]],"arrow-left-right":[["path",{"d":"M8 3 4 7l4 4"}],["path",{"d":"M4 7h16"}],["path",{"d":"m16 21 4-4-4-4"}],["path",{"d":"M20 17H4"}]],"briefcase":[["path",{"d":"M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"}],["rect",{"width":"20","height":"14","x":"2","y":"6","rx":"2"}]],"file-text":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M10 9H8"}],["path",{"d":"M16 13H8"}],["path",{"d":"M16 17H8"}]],"users-round":[["path",{"d":"M18 21a8 8 0 0 0-16 0"}],["circle",{"cx":"10","cy":"8","r":"5"}],["path",{"d":"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"}]],"boxes":[["path",{"d":"M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"}],["path",{"d":"m7 16.5-4.74-2.85"}],["path",{"d":"m7 16.5 5-3"}],["path",{"d":"M7 16.5v5.17"}],["path",{"d":"M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"}],["path",{"d":"m17 16.5-5-3"}],["path",{"d":"m17 16.5 4.74-2.85"}],["path",{"d":"M17 16.5v5.17"}],["path",{"d":"M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"}],["path",{"d":"M12 8 7.26 5.15"}],["path",{"d":"m12 8 4.74-2.85"}],["path",{"d":"M12 13.5V8"}]],"clipboard-check":[["rect",{"width":"8","height":"4","x":"8","y":"2","rx":"1","ry":"1"}],["path",{"d":"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"}],["path",{"d":"m9 14 2 2 4-4"}]],"wrench":[["path",{"d":"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"}]],"file-check-2":[["path",{"d":"M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m14 20 2 2 4-4"}]],"user-cog":[["path",{"d":"M10 15H6a4 4 0 0 0-4 4v2"}],["path",{"d":"m14.305 16.53.923-.382"}],["path",{"d":"m15.228 13.852-.923-.383"}],["path",{"d":"m16.852 12.228-.383-.923"}],["path",{"d":"m16.852 17.772-.383.924"}],["path",{"d":"m19.148 12.228.383-.923"}],["path",{"d":"m19.53 18.696-.382-.924"}],["path",{"d":"m20.772 13.852.924-.383"}],["path",{"d":"m20.772 16.148.924.383"}],["circle",{"cx":"18","cy":"15","r":"3"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"user-plus":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}],["line",{"x1":"19","x2":"19","y1":"8","y2":"14"}],["line",{"x1":"22","x2":"16","y1":"11","y2":"11"}]],"shield-alert":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"M12 8v4"}],["path",{"d":"M12 16h.01"}]],"database-backup":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 12a9 3 0 0 0 5 2.69"}],["path",{"d":"M21 9.3V5"}],["path",{"d":"M3 5v14a9 3 0 0 0 6.47 2.88"}],["path",{"d":"M12 12v4h4"}],["path",{"d":"M13 20a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L12 16"}]],"settings":[["path",{"d":"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"menu":[["path",{"d":"M4 5h16"}],["path",{"d":"M4 12h16"}],["path",{"d":"M4 19h16"}]],"search":[["path",{"d":"m21 21-4.34-4.34"}],["circle",{"cx":"11","cy":"11","r":"8"}]],"bell":[["path",{"d":"M10.268 21a2 2 0 0 0 3.464 0"}],["path",{"d":"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"}]],"user-round":[["circle",{"cx":"12","cy":"8","r":"5"}],["path",{"d":"M20 21a8 8 0 0 0-16 0"}]],"users":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{"d":"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"user-check":[["path",{"d":"m16 11 2 2 4-4"}],["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"log-out":[["path",{"d":"m16 17 5-5-5-5"}],["path",{"d":"M21 12H9"}],["path",{"d":"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}]],"chevron-right":[["path",{"d":"m9 18 6-6-6-6"}]],"trending-up":[["path",{"d":"M16 7h6v6"}],["path",{"d":"m22 7-8.5 8.5-5-5L2 17"}]],"alert-circle":[["circle",{"cx":"12","cy":"12","r":"10"}],["line",{"x1":"12","x2":"12","y1":"8","y2":"12"}],["line",{"x1":"12","x2":"12.01","y1":"16","y2":"16"}]],"check-circle-2":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]],"alert-triangle":[["path",{"d":"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],["path",{"d":"M12 9v4"}],["path",{"d":"M12 17h.01"}]],"chart-no-axes-combined":[["path",{"d":"M12 16v5"}],["path",{"d":"M16 14v7"}],["path",{"d":"M20 10v11"}],["path",{"d":"m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15"}],["path",{"d":"M4 18v3"}],["path",{"d":"M8 14v7"}]],"download":[["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]],"activity":[["path",{"d":"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]],"circle-check":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]],"clock-3":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6h4"}]],"package-search":[["path",{"d":"M12 22V12"}],["path",{"d":"M20.27 18.27 22 20"}],["path",{"d":"M21 10.498V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l.98-.559"}],["path",{"d":"M3.29 7 12 12l8.71-5"}],["path",{"d":"m7.5 4.27 8.997 5.148"}],["circle",{"cx":"18.5","cy":"16.5","r":"2.5"}]],"lightbulb":[["path",{"d":"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"}],["path",{"d":"M9 18h6"}],["path",{"d":"M10 22h4"}]],"upload":[["path",{"d":"M12 3v12"}],["path",{"d":"m17 8-5-5-5 5"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}]],"file-up":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M12 12v6"}],["path",{"d":"m15 15-3-3-3 3"}]],"info":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],"rotate-ccw":[["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{"d":"M3 3v5h5"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],"external-link":[["path",{"d":"M15 3h6v6"}],["path",{"d":"M10 14 21 3"}],["path",{"d":"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"}]],"arrow-down-left":[["path",{"d":"M17 7 7 17"}],["path",{"d":"M17 17H7V7"}]],"arrow-up-right":[["path",{"d":"M7 7h10v10"}],["path",{"d":"M7 17 17 7"}]],"archive":[["rect",{"width":"20","height":"5","x":"2","y":"3","rx":"1"}],["path",{"d":"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"}],["path",{"d":"M10 12h4"}]],"building-2":[["path",{"d":"M10 12h4"}],["path",{"d":"M10 8h4"}],["path",{"d":"M14 21v-3a2 2 0 0 0-4 0v3"}],["path",{"d":"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"}],["path",{"d":"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"}]],"calendar-days":[["path",{"d":"M8 2v4"}],["path",{"d":"M16 2v4"}],["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["path",{"d":"M3 10h18"}],["path",{"d":"M8 14h.01"}],["path",{"d":"M12 14h.01"}],["path",{"d":"M16 14h.01"}],["path",{"d":"M8 18h.01"}],["path",{"d":"M12 18h.01"}],["path",{"d":"M16 18h.01"}]],"circle-dot":[["circle",{"cx":"12","cy":"12","r":"10"}],["circle",{"cx":"12","cy":"12","r":"1"}]],"cloud":[["path",{"d":"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"}]],"database":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 5V19A9 3 0 0 0 21 19V5"}],["path",{"d":"M3 12A9 3 0 0 0 21 12"}]],"eye":[["path",{"d":"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"files":[["path",{"d":"M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"}],["path",{"d":"M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z"}],["path",{"d":"M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1"}]],"folder-open":[["path",{"d":"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"}]],"hash":[["line",{"x1":"4","x2":"20","y1":"9","y2":"9"}],["line",{"x1":"4","x2":"20","y1":"15","y2":"15"}],["line",{"x1":"10","x2":"8","y1":"3","y2":"21"}],["line",{"x1":"16","x2":"14","y1":"3","y2":"21"}]],"layers":[["path",{"d":"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"}],["path",{"d":"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"}],["path",{"d":"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"}]],"list-checks":[["path",{"d":"M13 5h8"}],["path",{"d":"M13 12h8"}],["path",{"d":"M13 19h8"}],["path",{"d":"m3 17 2 2 4-4"}],["path",{"d":"m3 7 2 2 4-4"}]],"loader-2":[["path",{"d":"M21 12a9 9 0 1 1-6.219-8.56"}]],"message-circle":[["path",{"d":"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"}]],"paperclip":[["path",{"d":"m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"}]],"pencil":[["path",{"d":"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],["path",{"d":"m15 5 4 4"}]],"plus-circle":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M8 12h8"}],["path",{"d":"M12 8v8"}]],"refresh-cw":[["path",{"d":"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{"d":"M21 3v5h-5"}],["path",{"d":"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{"d":"M8 16H3v5"}]],"scan-text":[["path",{"d":"M3 7V5a2 2 0 0 1 2-2h2"}],["path",{"d":"M17 3h2a2 2 0 0 1 2 2v2"}],["path",{"d":"M21 17v2a2 2 0 0 1-2 2h-2"}],["path",{"d":"M7 21H5a2 2 0 0 1-2-2v-2"}],["path",{"d":"M7 8h8"}],["path",{"d":"M7 12h10"}],["path",{"d":"M7 16h6"}]],"send":[["path",{"d":"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"}],["path",{"d":"m21.854 2.147-10.94 10.939"}]],"shield-check":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"m9 12 2 2 4-4"}]],"trash-2":[["path",{"d":"M10 11v6"}],["path",{"d":"M14 11v6"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M3 6h18"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],"image":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2","ry":"2"}],["circle",{"cx":"9","cy":"9","r":"2"}],["path",{"d":"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"}]],"file-spreadsheet":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M8 13h2"}],["path",{"d":"M14 13h2"}],["path",{"d":"M8 17h2"}],["path",{"d":"M14 17h2"}]],"clock":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6l4 2"}]],"trash":[["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M3 6h18"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],"calendar-check-2":[["path",{"d":"M8 2v4"}],["path",{"d":"M16 2v4"}],["path",{"d":"M21 14V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"}],["path",{"d":"M3 10h18"}],["path",{"d":"m16 20 2 2 4-4"}]],"cloud-upload":[["path",{"d":"M12 13v8"}],["path",{"d":"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"}],["path",{"d":"m8 17 4-4 4 4"}]],"upload-cloud":[["path",{"d":"M12 13v8"}],["path",{"d":"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"}],["path",{"d":"m8 17 4-4 4 4"}]],"file-scan":[["path",{"d":"M20 10V8a2.4 2.4 0 0 0-.706-1.704l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h4.35"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M16 14a2 2 0 0 0-2 2"}],["path",{"d":"M16 22a2 2 0 0 1-2-2"}],["path",{"d":"M20 14a2 2 0 0 1 2 2"}],["path",{"d":"M20 22a2 2 0 0 0 2-2"}]],"file-search":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["circle",{"cx":"11.5","cy":"14.5","r":"2.5"}],["path",{"d":"M13.3 16.3 15 18"}]],"file":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}]],"file-type-2":[["path",{"d":"M12 22h6a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v6"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M3 16v-1.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5V16"}],["path",{"d":"M6 22h2"}],["path",{"d":"M7 14v8"}]],"sheet":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2","ry":"2"}],["line",{"x1":"3","x2":"21","y1":"9","y2":"9"}],["line",{"x1":"3","x2":"21","y1":"15","y2":"15"}],["line",{"x1":"9","x2":"9","y1":"9","y2":"21"}],["line",{"x1":"15","x2":"15","y1":"9","y2":"21"}]],"file-image":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["circle",{"cx":"10","cy":"12","r":"2"}],["path",{"d":"m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22"}]],"file-type":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M11 18h2"}],["path",{"d":"M12 12v6"}],["path",{"d":"M9 13v-.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v.5"}]],"file-archive":[["path",{"d":"M13.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v11.5"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M8 12v-1"}],["path",{"d":"M8 18v-2"}],["path",{"d":"M8 7V6"}],["circle",{"cx":"8","cy":"20","r":"2"}]],"file-audio":[["path",{"d":"M4 6.835V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-.343"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M2 19a2 2 0 0 1 4 0v1a2 2 0 0 1-4 0v-4a6 6 0 0 1 12 0v4a2 2 0 0 1-4 0v-1a2 2 0 0 1 4 0"}]],"file-video":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M15.033 13.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56v-4.704a.645.645 0 0 1 .967-.56z"}]],"presentation":[["path",{"d":"M2 3h20"}],["path",{"d":"M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"}],["path",{"d":"m7 21 5-5 5 5"}]],"check-circle":[["path",{"d":"M21.801 10A10 10 0 1 1 17 3.335"}],["path",{"d":"m9 11 3 3L22 4"}]]};
  function refreshIcons() {
    document.querySelectorAll("i[data-lucide]").forEach((placeholder) => {
      const name = placeholder.getAttribute("data-lucide");
      const nodes = iconNodes[name];
      if (!nodes) return;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: "lucide " + (placeholder.getAttribute("class") || "") })) svg.setAttribute(key, value);
      if (placeholder.getAttribute("style")) svg.setAttribute("style", placeholder.getAttribute("style"));
      nodes.forEach(([tag, attributes]) => {
        const child = document.createElementNS("http://www.w3.org/2000/svg", tag);
        Object.entries(attributes).forEach(([key, value]) => child.setAttribute(key, value));
        svg.appendChild(child);
      });
      placeholder.replaceWith(svg);
    });
  }


    refreshIcons();

    /* ---------------- 2. INDEXEDDB FILE STORAGE ---------------- */
    const DB_NAME = "PGENRO_Document_Store";
    const DB_VERSION = 1;
    const STORE_NAME = "uploaded_files";

    function openFileDatabase() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async function storeFileLocally(id, file) {
      if (!id || !file) return;
      try {
        const db = await openFileDatabase();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          store.put({
            id: String(id),
            name: file.name,
            type: file.type,
            size: file.size,
            blob: file,
            updatedAt: Date.now()
          });
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        });
      } catch (err) {
        console.warn("IndexedDB store notice:", err);
      }
    }

    async function getStoredFile(id) {
      if (!id) return null;
      try {
        const db = await openFileDatabase();
        return new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(String(id));
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });
      } catch {
        return null;
      }
    }

    async function deleteStoredFile(id) {
      if (!id) return;
      try {
        const db = await openFileDatabase();
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(String(id));
      } catch (e) {
        console.warn("Delete error:", e);
      }
    }

    /* ---------------- 3. DOM ELEMENTS ---------------- */
    const dbStatusDot = $("#dbStatusDot");
    const dbStatusText = $("#dbStatusText");

    const communicationTableBody = $("#communicationTableBody");
    const tablePaginationInfo = $("#tablePaginationInfo");
    const tableSearchInput = $("#tableSearchInput");
    const globalSearchInput = $("#globalSearchInput");
    const statusFilter = $("#statusFilter");
    const filterTabs = $$(".filter-tab");
    const selectAllRows = $("#selectAllRows");
    const bulkSelectionBar = $("#bulkSelectionBar");
    const selectedCountText = $("#selectedCountText");
    const bulkArchiveBtn = $("#bulkArchiveBtn");
    const bulkDeleteBtn = $("#bulkDeleteBtn");
    const clearSelectionBtn = $("#clearSelectionBtn");
    const exportCommunicationsBtn = $("#exportCommunicationsBtn");
    const syncCommunicationsBtn = $("#syncCommunicationsBtn");
    const notificationList = $("#notificationList");
    const notifBadgeCount = $("#notifBadgeCount");
    const notifPing = $("#notifPing");

    const kpiTotalRecords = $("#kpiTotalRecords");
    const kpiIncomingCount = $("#kpiIncomingCount");
    const kpiOutgoingCount = $("#kpiOutgoingCount");
    const kpiPendingCount = $("#kpiPendingCount");

    // Modal Form Elements
    const encodingModal = $("#encodingModal");
    const openEncodingModalBtn = $("#openEncodingModalBtn");
    const closeEncodingModalBtn = $("#closeEncodingModalBtn");
    const cancelEncodingBtn = $("#cancelEncodingBtn");
    const communicationForm = $("#communicationForm");
    const modalTitle = $("#modalTitle");

    const editIndexInput = $("#editIndex");
    const typeSelect = $("#typeSelect");
    const controlNoInput = $("#controlNoInput");
    const docTypeSelect = $("#docTypeSelect");
    const dateInput = $("#dateInput");
    const statusSelect = $("#statusSelect");
    const officeInput = $("#officeInput");
    const subjectInput = $("#subjectInput");
    const actionTakenInput = $("#actionTakenInput");
    const remarksInput = $("#remarksInput");
    const ocrTextInput = $("#ocrTextInput");
    const ocrStatsChip = $("#ocrStatsChip");

    // File Elements
    const documentFileInput = $("#documentFileInput");
    const browseDocumentBtn = $("#browseDocumentBtn");
    const removeDocumentBtn = $("#removeDocumentBtn");
    const runOcrBtn = $("#runOcrBtn");
    const ocrActionSubtext = $("#ocrActionSubtext");
    const filePickerState = $("#filePickerState");
    const filePickerIcon = $("#filePickerIcon");
    const fileNameDisplay = $("#fileNameDisplay");
    const fileMetaDisplay = $("#fileMetaDisplay");

    // Live Preview
    const filePreviewContainer = $("#filePreviewContainer");
    const filePreviewBody = $("#filePreviewBody");
    const previewBadge = $("#previewBadge");
    const previewOpenExternalBtn = $("#previewOpenExternalBtn");

    // Progress Bar & Submit
    const encodingUploadProgressBox = $("#encodingUploadProgressBox");
    const encodingUploadStatusText = $("#encodingUploadStatusText");
    const encodingProgressBar = $("#encodingProgressBar");
    const saveRecordBtn = $("#saveRecordBtn");

    // Viewer Modals
    const viewOcrModal = $("#viewOcrModal");
    const viewOcrContent = $("#viewOcrContent");
    const viewOcrFileName = $("#viewOcrFileName");
    const closeViewOcrModalBtn = $("#closeViewOcrModalBtn");

    const viewDocumentModal = $("#viewDocumentModal");
    const docViewerTitle = $("#docViewerTitle");
    const docViewerSubtitle = $("#docViewerSubtitle");
    const docViewerIframe = $("#docViewerIframe");
    const docViewerImage = $("#docViewerImage");
    const docViewerFallback = $("#docViewerFallback");
    const docViewerDownloadBtn = $("#docViewerDownloadBtn");
    const docViewerExternalBtn = $("#docViewerExternalBtn");
    const closeDocViewerBtn = $("#closeDocViewerBtn");

    // Profile Dropdown
    const profileMenu = $("#profileMenu");
    const profileBtn = $("#profileBtn");
    const profileDropdown = $("#profileDropdown");
    const notificationsBtn = $("#notificationsBtn");
    const notificationDropdown = $("#notificationDropdown");
    const logoutBtn = $("#logoutBtn");
    const sidebar = $("#sidebar");
    const sidebarCollapseBtn = $("#sidebarCollapseBtn");
    const mobileMenuBtn = $("#mobileMenuBtn");
    const mainWrapper = $(".main-wrapper");

    /* ---------------- 4. APPLICATION STATE ---------------- */
    let records = [];
    let currentTypeFilter = "All";
    let currentStatusFilter = "All";
    let selectedFile = null;
    let existingEditFileName = "";
    let existingEditDriveLink = "";
    let activePreviewBlobUrl = null;
    let cloudRecordsAvailable = false;
    const selectedRecordIds = new Set();

    const COMMUNICATIONS_TABLE = "communications";
    const supabaseClient = window.pgenroSupabase || null;
    const supabaseConfigured = Boolean(window.PGENRO_SUPABASE?.configured && supabaseClient);
    const OCR_SERVER_URL = "http://127.0.0.1:5000";
    const SUPPORTED_DOCUMENT_TYPES = new Set([
      "pdf", "png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff",
      "docx", "txt", "csv", "xlsx", "pptx"
    ]);
    const MAX_FILE_SIZE = 50 * 1024 * 1024;

    /* ---------------- 5. PROFILE & DROPDOWN HANDLING ---------------- */
    function closeProfileDropdown() {
      if (!profileDropdown || !profileBtn) return;
      profileDropdown.classList.remove("open");
      profileMenu?.classList.remove("open");
      profileBtn.setAttribute("aria-expanded", "false");
      profileDropdown.style.display = "none";
    }

    function openProfileDropdown() {
      if (!profileDropdown || !profileBtn) return;
      if (notificationDropdown) {
        notificationDropdown.classList.remove("open");
        notificationDropdown.style.display = "none";
        notificationsBtn?.setAttribute("aria-expanded", "false");
      }
      profileDropdown.classList.add("open");
      profileMenu?.classList.add("open");
      profileBtn.setAttribute("aria-expanded", "true");
      profileDropdown.style.display = "block";
    }

    profileBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      profileDropdown.classList.contains("open") ? closeProfileDropdown() : openProfileDropdown();
    });

    document.addEventListener("click", (e) => {
      if (!profileMenu?.contains(e.target)) closeProfileDropdown();
      if (notificationDropdown && !notificationDropdown.contains(e.target) && !notificationsBtn?.contains(e.target)) {
        notificationDropdown.classList.remove("open");
        notificationDropdown.style.display = "none";
        notificationsBtn?.setAttribute("aria-expanded", "false");
      }
    });

    /* ---------------- 5B. RESPONSIVE ADMIN SHELL ---------------- */
    let sidebarBackdrop = $(".admin-sidebar-backdrop");
    if (!sidebarBackdrop) {
      sidebarBackdrop = document.createElement("div");
      sidebarBackdrop.className = "admin-sidebar-backdrop";
      sidebarBackdrop.setAttribute("aria-hidden", "true");
      document.body.appendChild(sidebarBackdrop);
    }

    const isMobileViewport = () => window.matchMedia("(max-width: 900px)").matches;

    function setMobileSidebar(open) {
      sidebar?.classList.toggle("mobile-open", Boolean(open));
      sidebarBackdrop?.classList.toggle("active", Boolean(open));
      sidebarBackdrop?.setAttribute("aria-hidden", String(!open));
      mobileMenuBtn?.setAttribute("aria-expanded", String(Boolean(open)));
      document.body.classList.toggle("admin-mobile-nav-open", Boolean(open));
    }

    function setDesktopSidebarCollapsed(collapsed) {
      if (!sidebar) return;
      sidebar.classList.toggle("collapsed", Boolean(collapsed));
      mainWrapper?.classList.toggle("sidebar-collapsed", Boolean(collapsed));
      document.body.classList.toggle("sidebar-collapsed", Boolean(collapsed));
      sidebarCollapseBtn?.setAttribute("aria-expanded", String(!collapsed));
      sidebarCollapseBtn?.setAttribute("aria-label", collapsed ? "Expand administrator menu" : "Collapse administrator menu");
      if (sidebarCollapseBtn) sidebarCollapseBtn.title = collapsed ? "Expand Menu" : "Collapse Menu";
      try { localStorage.setItem("pgenro_admin_sidebar", collapsed ? "collapsed" : "expanded"); } catch {}
    }

    mobileMenuBtn?.setAttribute("aria-expanded", "false");
    mobileMenuBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      setMobileSidebar(!sidebar?.classList.contains("mobile-open"));
    });

    sidebarCollapseBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      if (isMobileViewport()) {
        setMobileSidebar(false);
        return;
      }
      setDesktopSidebarCollapsed(!sidebar?.classList.contains("collapsed"));
    });

    sidebarBackdrop?.addEventListener("click", () => setMobileSidebar(false));
    sidebar?.querySelectorAll("a.nav-item").forEach(link => {
      link.setAttribute("aria-label", link.textContent.trim());
      link.title = link.textContent.trim();
      link.addEventListener("click", () => {
        if (isMobileViewport()) setMobileSidebar(false);
      });
    });

    notificationsBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeProfileDropdown();
      const opening = !notificationDropdown?.classList.contains("open");
      notificationDropdown?.classList.toggle("open", opening);
      if (notificationDropdown) notificationDropdown.style.display = opening ? "block" : "none";
      notificationsBtn?.setAttribute("aria-expanded", String(opening));
    });

    logoutBtn?.addEventListener("click", async (e) => {
      e.preventDefault();
      try { await supabaseClient?.auth?.signOut?.(); } catch (error) { console.warn("Sign-out notice:", error); }
      sessionStorage.clear();
      window.location.href = "../User/login.html";
    });

    window.addEventListener("resize", () => {
      if (!isMobileViewport()) {
        setMobileSidebar(false);
        try { setDesktopSidebarCollapsed(localStorage.getItem("pgenro_admin_sidebar") === "collapsed"); } catch {}
      } else {
        sidebar?.classList.remove("collapsed");
        mainWrapper?.classList.remove("sidebar-collapsed");
        document.body.classList.remove("sidebar-collapsed");
      }
    });

    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        globalSearchInput?.focus();
        globalSearchInput?.select?.();
        return;
      }

      if (e.key === "Escape") {
        setMobileSidebar(false);
        closeProfileDropdown();
        notificationDropdown?.classList.remove("open");
        if (notificationDropdown) notificationDropdown.style.display = "none";
        notificationsBtn?.setAttribute("aria-expanded", "false");

        if (viewDocumentModal?.classList.contains("open")) {
          viewDocumentModal.classList.remove("open");
          viewDocumentModal.setAttribute("aria-hidden", "true");
          if (docViewerIframe) docViewerIframe.src = "";
          if (docViewerImage) docViewerImage.src = "";
        } else if (viewOcrModal?.classList.contains("open")) {
          viewOcrModal.classList.remove("open");
          viewOcrModal.setAttribute("aria-hidden", "true");
        } else if (encodingModal?.classList.contains("open")) {
          closeEncodingModal();
        }

        if (!document.querySelector(".modal-overlay.open")) {
          document.body.classList.remove("admin-modal-open");
        }
      }
    });

    if (!isMobileViewport()) {
      try { setDesktopSidebarCollapsed(localStorage.getItem("pgenro_admin_sidebar") === "collapsed"); } catch {}
    }

    /* ---------------- 6. DATE FORMATTER ---------------- */
    function parseDateValue(str) {
      if (!str) return "";
      const text = String(str).trim();
      const monthNames = [
        "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december"
      ];

      // Format: "02 January 2025" o "2 January 2025"
      const dayFirstMatch = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\b/i);
      if (dayFirstMatch) {
        const day = Number(dayFirstMatch[1]);
        const monthStr = dayFirstMatch[2].toLowerCase();
        const year = Number(dayFirstMatch[3]);
        const mIdx = monthNames.findIndex(m => m.startsWith(monthStr.slice(0, 3)));
        if (mIdx !== -1) {
          return `${year}-${String(mIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }
      }

      // Format: "January 02, 2025"
      const monthFirstMatch = text.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
      if (monthFirstMatch) {
        const monthStr = monthFirstMatch[1].toLowerCase();
        const day = Number(monthFirstMatch[2]);
        const year = Number(monthFirstMatch[3]);
        const mIdx = monthNames.findIndex(m => m.startsWith(monthStr.slice(0, 3)));
        if (mIdx !== -1) {
          return `${year}-${String(mIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }
      }

      // Format: YYYY-MM-DD
      const isoMatch = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
      if (isoMatch) {
        return `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, "0")}-${String(isoMatch[3]).padStart(2, "0")}`;
      }

      return "";
    }

    /* ---------------- 7. UNIVERSAL DOCUMENT OCR PARSER ---------------- */
    function normalizeOcrSpacing(value = "") {
      return String(value || "")
        .replace(/\u00A0/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim();
    }

    function getNormalizedLines(rawText = "") {
      return String(rawText || "")
        .replace(/\r/g, "")
        .replace(/\u00A0/g, " ")
        .split("\n")
        .map(line => normalizeOcrSpacing(line))
        .filter(Boolean);
    }

    function getOcrHeaderLines(rawText = "") {
      const lines = getNormalizedLines(rawText).slice(0, 40);
      const end = lines.findIndex(line =>
        /^(?:SUBJECT(?:\s+MATTER)?|SUBJ|RE)(?:\s*[:;.-]|$)/i.test(line) ||
        /^(?:DEAR|GREETINGS|SIR|MADAM|MA'AM|TO WHOM IT MAY CONCERN|SINCERELY|RESPECTFULLY)\b/i.test(line)
      );
      if (end < 0) return lines;
      const salutation = /^(?:DEAR|GREETINGS|SIR|MADAM|MA'AM|TO WHOM IT MAY CONCERN)\b/i.test(lines[end]);
      return lines.slice(0, end + (salutation ? 1 : 0));
    }

    function isSectionLabel(line = "") {
      return /^(?:DATE|DATE\s+RECEIVED|DATE\s+RELEASED|DATED|FROM|TO|T0|THRU|REF(?:ERENCE)?|SUBJECT(?:\s+MATTER)?|SUBJ)\s*[:;.-]?\s*/i.test(line);
    }

    function cleanOfficeName(value = "") {
      return normalizeOcrSpacing(value)
        .replace(/\s{2,}/g, " ")
        .replace(/^[|:;,.\-]+|[|:;,.\-]+$/g, "")
        .trim();
    }

    function ensureDocumentTypeOptions() {
      if (!docTypeSelect) return;

      const requiredOptions = [
        "Office Order",
        "Special Order",
        "Travel Order",
        "Request Letter",
        "Endorsement Letter",
        "Transmittal Letter",
        "Response Letter",
        "Notice of Meeting",
        "Invitation",
        "Report",
        "Memorandum",
        "Other File"
      ];

      const existing = new Set(
        Array.from(docTypeSelect.options).map(option =>
          String(option.value || "").trim().toLowerCase()
        )
      );

      requiredOptions.forEach(label => {
        if (existing.has(label.toLowerCase())) return;
        const option = document.createElement("option");
        option.value = label;
        option.textContent = label;
        docTypeSelect.appendChild(option);
      });
    }

    function findExplicitField(text, labels) {
      const escapedLabels = labels
        .map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");

      const regex = new RegExp(
        `(?:^|\\n)\\s*(?:${escapedLabels})\\s*[:;.-]\\s*([^\\n\\r]+)`,
        "i"
      );

      const match = String(text || "").match(regex);
      return match?.[1] ? normalizeOcrSpacing(match[1]) : "";
    }

    function extractSourceOffice(text = "", lines = []) {
      // 1. Prefer an explicit sender/originating-office field.
      const headerLines = getOcrHeaderLines(text);
      const explicitFrom = findExplicitField(headerLines.join("\n"), [
        "FROM",
        "ISSUED BY",
        "ISSUING OFFICE",
        "ORIGINATING OFFICE",
        "SENDER"
      ]);

      if (explicitFrom) return cleanOfficeName(explicitFrom);

      // 2. Read the document letterhead from the upper portion only.
      const candidates = [];

      for (const line of headerLines) {
        // Stop when normal document fields begin.
        if (/^(?:TO|T0|SUBJECT|SUBJ|DATE|FROM|THRU|REF|DEAR)\b/i.test(line)) {
          break;
        }
        if (/^(?:(?:PG\s+)?ENRO\s+)?(?:OFFICE|SPECIAL|TRAVEL)\s+ORDER\b|^(?:MEMORANDUM|MEMO)\b/i.test(line)) {
          break;
        }

        if (/\b(?:OFFICE|DEPARTMENT|DIVISION|SECTION|BUREAU|CENTER|CENTRE|COMMISSION|COUNCIL|UNIVERSITY|COLLEGE|SCHOOL|COMPANY|CORPORATION|INC\.?|LTD\.?|ASSOCIATION|FOUNDATION|AGENCY|GOVERNMENT|BARANGAY|MUNICIPAL|PROVINCIAL|CITY)\b/i.test(line)) {
          candidates.push(line);
        }
      }

      // Avoid treating a person's name or addressee as the source office.
      const office = cleanOfficeName(candidates.join(" "));
      if (office && !/^(?:HON\.?|MR\.?|MS\.?|MRS\.?|ATTY\.?|DR\.?)\b/i.test(office)) {
        return office;
      }

      return "";
    }

    function detectDocumentTypeUniversal(text = "", lines = []) {
      const upperLines = lines
        .slice(0, 35)
        .map(line => line.toUpperCase().trim());

      // IMPORTANT: document type is detected ONLY from an explicit title/heading.
      // Words such as "request" inside a subject/body must NOT make it a Request Letter.
      const headingRules = [
        { type: "Office Order", patterns: [/^PG\s+ENRO\s+OFFICE\s+ORDER\b/, /^OFFICE\s+ORDER(?:\s+NO\.?|\b)/] },
        { type: "Special Order", patterns: [/^SPECIAL\s+ORDER(?:\s+NO\.?|\b)/] },
        { type: "Travel Order", patterns: [/^TRAVEL\s+ORDER(?:\s+NO\.?|\b)/] },
        { type: "Memorandum", patterns: [/^MEMORANDUM(?:\s+NO\.?|\b)/, /^MEMO(?:\s+NO\.?|\b)/, /^MEMORANDUM$/] },
        { type: "Notice of Meeting", patterns: [/^NOTICE\s+OF\s+MEETING$/] },
        { type: "Endorsement Letter", patterns: [/^ENDORSEMENT\s+LETTER$/, /^LETTER\s+OF\s+ENDORSEMENT$/] },
        { type: "Transmittal Letter", patterns: [/^TRANSMITTAL\s+LETTER$/, /^LETTER\s+OF\s+TRANSMITTAL$/] },
        { type: "Response Letter", patterns: [/^RESPONSE\s+LETTER$/, /^LETTER\s+OF\s+RESPONSE$/] },
        { type: "Request Letter", patterns: [/^REQUEST\s+LETTER$/, /^LETTER\s+OF\s+REQUEST$/] },
        { type: "Invitation", patterns: [/^INVITATION(?:\s+LETTER)?$/] },
        { type: "Report", patterns: [/^REPORT(?:\s+ON|\s+OF|\s+NO\.?|$)/] },
        { type: "Certification", patterns: [/^CERTIFICATION$/, /^CERTIFICATE$/] }
      ];

      for (const line of upperLines) {
        if (!line || line.length > 120) continue;

        for (const rule of headingRules) {
          if (rule.patterns.some(pattern => pattern.test(line))) {
            return rule.type === "Certification" ? "Other File" : rule.type;
          }
        }
      }

      // Secondary explicit heading search for common formats such as:
      // "PG ENRO OFFICE ORDER NO. 25-002" or "OFFICE ORDER NO. 25-002"
      const upperHeader = upperLines.join(" ");
      if (/\bOFFICE\s+ORDER\s+NO\.?\s*[A-Z0-9-]+/i.test(upperHeader)) return "Office Order";
      if (/\bSPECIAL\s+ORDER\s+NO\.?\s*[A-Z0-9-]+/i.test(upperHeader)) return "Special Order";
      if (/\bTRAVEL\s+ORDER\s+NO\.?\s*[A-Z0-9-]+/i.test(upperHeader)) return "Travel Order";
      if (/\bMEMORANDUM\s+(?:NO\.?|NUMBER)\s*[A-Z0-9-]+/i.test(upperHeader)) return "Memorandum";

      // Never infer document type from a generic word appearing in the body/subject.
      return "";
    }

    function extractRecipient(text = "", lines = []) {
      // A communication's addressee is in the header, never in its signature.
      const header = getOcrHeaderLines(text);
      for (let i = 0; i < header.length; i += 1) {
        const match = header[i].match(
          /^(?:TO|T0|MEMORANDUM\s+FOR|ADDRESSED\s+TO|ATTENTION|ATTN\.?|FOR)\s*[:;.-]\s*(.*)$/i
        );
        if (!match) continue;
        const parts = [];
        if (match[1].trim()) parts.push(match[1].trim());
        for (let j = i + 1; j < header.length && j <= i + 3; j += 1) {
          const next = header[j];
          if (/^(?:SUBJECT(?:\s+MATTER)?|SUBJ|RE|DATE|FROM|THRU|REF(?:ERENCE)?)\b\s*[:;.-]/i.test(next)) break;
          if (/^(?:DEAR|GREETINGS|SIR|MADAM|PLEASE|THIS|WE|I|IN\s+LIGHT\s+OF)\b/i.test(next)) break;
          if (/^\d+\.|^[•*-]\s+/.test(next) || next.length > 100) break;
          if (parts.join(" ").length + next.length > 170) break;
          parts.push(next);
        }
        if (parts.length) return cleanOfficeName(parts.join(" "));
      }

      // Letters without TO: use the addressee immediately above the salutation.
      const salutation = header.findIndex(line => /^(?:DEAR|GREETINGS|SIR|MADAM|MA'AM|TO WHOM IT MAY CONCERN)\b/i.test(line));
      if (salutation > 0) {
        for (let i = salutation - 1; i >= Math.max(0, salutation - 3); i -= 1) {
          const line = header[i];
          if (/^(?:DATE|FROM|REF|SUBJECT|REPUBLIC|PROVINCE OF|PROVINCIAL GOVERNMENT)\b/i.test(line)) break;
          if (/^(?:\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{1,2}-\d{1,2})$/i.test(line)) break;
          if (line.length >= 3 && line.length <= 150) return cleanOfficeName(line);
        }
      }
      return "";
    }

    function extractSignatory(text = "") {
      const lines = getNormalizedLines(text);
      let found = "";
      for (let i = 0; i < lines.length; i += 1) {
        let name = lines[i].replace(/^(EnP|Engr|Atty|Dr|Hon|Mr|Ms|Mrs)\s*['.:-]?\s*/i, "$1 ").trim();
        if (name.length < 8 || name.length > 105) continue;
        const titled = /^(?:EnP|Engr|Atty|Dr|Hon|Mr|Ms|Mrs)\.?\s+/i.test(name);
        const words = name.match(/[A-Za-z][A-Za-z.'-]*/g) || [];
        if (words.length < 3 || words.length > 10) continue;
        if (/\b(?:REPUBLIC|PROVINCE|GOVERNMENT|OFFICE|ORDER|SUBJECT|PERSONNEL|DIVISION|DEPARTMENT|SCHEDULE|TRAVEL|COMPLIANCE)\b/i.test(name)) continue;
        let role = lines[i + 1]?.replace(/^[|:;.-]+|[|:;.-]+$/g, "").trim() || "";
        const hasRole = /\b(?:PGDH|PGENRO|PG\s*ENRO|OFFICER|DIRECTOR|CHIEF|MAYOR|ADMINISTRATOR|SUPERVISOR|MANAGER|SECRETARY|DEPARTMENT\s+HEAD|DIVISION\s+HEAD)\b/i.test(role);
        const closing = lines.slice(Math.max(0, i - 4), i)
          .some(line => /\b(?:SINCERELY|RESPECTFULLY|TRULY|COMPLIANCE|VERY\s+TRULY|YOURS)\b/i.test(line));
        if (!((titled && hasRole) || (hasRole && name === name.toUpperCase()) || (titled && closing) || (closing && name === name.toUpperCase()))) continue;
        role = hasRole ? role.replace(/\bPGDH\s+PG[:. -]*ENRO[A-Z]?\b.*$/i, "PGDH PG ENRO") : "";
        found = role ? `${name} — ${role}` : name;
      }
      return found;
    }

    const SUBJECT_LABEL = String.raw`(?:S\s*U\s*B\s*[JI1]\s*E\s*C\s*T(?:\s+MATTER)?|SUBJ\.?)`;
    const SUBJECT_RE = new RegExp(`^[|!•>\\[\\]\\s]*(?:${SUBJECT_LABEL}(?:\\s*[:;：；.\\-–—=|]+\\s*|\\s+|$)|RE\\s*[:;：]\\s*)(.*)$`, "i");
    const CONTROL_LABEL = String.raw`(?:(?:DOCUMENT\s+)?(?:CONTROL|TRACKING|REFERENCE|REF\.?|DOCUMENT|DOC\.?)\s*(?:NO\.?|NUMBER|#)|(?:OFFICE\s+MEMORANDUM|MEMORANDUM|MEMO|OFFICE\s+ORDER|SPECIAL\s+ORDER|TRAVEL\s+ORDER|ADMINISTRATIVE\s+ORDER|CIRCULAR|RESOLUTION)\s*(?:NO\.?|NUMBER|#)|NO\.?|NUMBER)`;
    const CONTROL_RE = new RegExp(`^${CONTROL_LABEL}(?=\\s|[:#.=\\-]|$)\\s*[:#.=\\-]?\\s*(.*)$`, "i");
    const FIELD_RE = /^(?:DATE(?:\s+(?:RECEIVED|RELEASED|ISSUED))?|DATED|FROM|TO|T0|FOR|THRU|THROUGH|CC|ATTACHMENTS?|ENCLOSURES?|REF(?:ERENCE)?|STATUS|REMARKS)\s*(?:[:;\-]|$)/i;
    const BODY_RE = /^(?:DEAR|GREETINGS|SIR|MADAM|MA'AM|TO\s+WHOM|PLEASE|KINDLY|THIS\s+(?:IS|HAS|WILL|REFERS)|WE\s+(?:ARE|WILL|WOULD|REQUEST)|I\s+(?:AM|WOULD)|YOU\s+ARE|THE\s+UNDERSIGNED|IN\s+(?:LIGHT\s+OF|CONNECTION\s+WITH)|PURSUANT\s+TO|FOR\s+YOUR\s+(?:INFORMATION|COMPLIANCE)|SINCERELY|RESPECTFULLY)\b/i;
    const SERIES_RE = /^(?:,\s*)?(?:S\.?|SERIES\s+OF)\s*[,.:]?\s*(?:19|20)\d{2}\.?$/i;

    function normalizeControlNumber(value) {
      return String(value || "").replace(/[\u2010-\u2015\u2212]/g, "-")
        .replace(/\s*([/._-])\s*/g, "$1").replace(/\b(s\.)\s*(?=\d{4}\b)/gi, "$1 ").replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
    }

    function controlNumberKey(value) {
      return normalizeControlNumber(value).replace(/\s+/g, "").toUpperCase();
    }

    function normalizeHeaderLayout(text) {
      return String(text || "").replace(/\r\n?/g, "\n").replace(/：/g, ":").replace(/；/g, ";").replace(/\u200b/g, "")
        .split("\n").map(line => {
          if (!/^[|!•>\[\]\s]*(?:TO|T0|FROM|DATE|THRU|FOR|SUBJECT|SUBJ|RE|CONTROL|MEMORANDUM)\b/i.test(line)) return line;
          const boundary = new RegExp(`[ \\t|]+(?=(?:${SUBJECT_LABEL}|DATE(?:\\s+(?:ISSUED|RECEIVED|RELEASED))?|FROM|TO|THRU|CONTROL\\s+(?:NO\\.?|NUMBER))\\s*[:;：])`, "gi");
          return line.replace(boundary, "\n");
        }).join("\n");
    }

    function parseHeaderFields(text) {
      const lines = normalizeHeaderLayout(text).split("\f")[0]
        .split("\n").map(line => line.replace(/[ \t\u00a0]+/g, " ").trim());
      let subject = "", subjectSource = "", i = 0, seen = 0;
      const candidates = [];
      while (i < lines.length && seen < 60) {
        const line = lines[i];
        if (!line) { i++; continue; }
        seen++;
        if (BODY_RE.test(line)) break;
        const match = line.match(SUBJECT_RE);
        if (match) {
          const inline = match[1].replace(/^[|:;：\s]+/, "").trim();
          const parts = inline ? [inline] : [];
          const start = i++;
          let gaps = 0;
          while (i < lines.length) {
            const next = lines[i];
            if (!next) {
              let probe = i + 1;
              while (probe < lines.length && !lines[probe]) probe++;
              if (parts.length && probe < lines.length && probe - i <= 2
                && !BODY_RE.test(lines[probe]) && !FIELD_RE.test(lines[probe])
                && !CONTROL_RE.test(lines[probe]) && !SUBJECT_RE.test(lines[probe])
                && !/[.!?]$/.test(parts[parts.length - 1])
                && (/^(?:FOR|OF|ON|AND|OR|WITH|REGARDING|DURING)\b/i.test(lines[probe])
                  || /\b(?:FOR|OF|ON|AND|OR|WITH|REGARDING|DURING)$/i.test(parts[parts.length - 1]))) {
                i = probe; continue;
              }
              if (parts.length || gaps >= 2) break;
              gaps++; i++; continue;
            }
            if (!parts.length && /^[:;：|\-]+$/.test(next)) { i++; continue; }
            if (FIELD_RE.test(next) || CONTROL_RE.test(next) || SUBJECT_RE.test(next)
              || BODY_RE.test(next) || /^(?:\d+[.)]\s|[•*]\s|[-_=]{3,}$)/.test(next)) break;
            if (parts.length && /[.!?]$/.test(parts[parts.length - 1])) break;
            parts.push(next); i++;
          }
          if (!subject) { subject = parts.join(" ").replace(/\s+/g, " ").trim(); subjectSource = lines.slice(start, i).join("\n"); }
          let probe = i;
          while (probe < lines.length && !lines[probe]) probe++;
          if (probe >= lines.length || !(FIELD_RE.test(lines[probe]) || CONTROL_RE.test(lines[probe]))) break;
          i = probe; continue;
        }
        const control = line.match(CONTROL_RE);
        if (control) {
          let raw = control[1].trim(), consumed = i;
          if (!raw) {
            let probe = i + 1;
            while (probe < Math.min(lines.length, i + 4) && !lines[probe]) probe++;
            if (probe < lines.length) { raw = lines[probe]; consumed = probe; }
          }
          let value = normalizeControlNumber(raw);
          if (/^[A-Z0-9]+(?:[._/-][A-Z0-9]+)*(?:,?\s*(?:S\.?|SERIES\s+OF)\s*[,.:]?\s*(?:19|20)\d{2})?$/i.test(value) && /\d/.test(value)) {
            let probe = consumed + 1;
            while (probe < Math.min(lines.length, consumed + 3) && !lines[probe]) probe++;
            if (probe < lines.length && SERIES_RE.test(lines[probe]) && !/(?:S\.|SERIES\s+OF)/i.test(value)) {
              value += ", " + lines[probe].replace(/^[, ]+|\.$/g, ""); consumed = probe;
            }
            const priority = /^(?:REFERENCE|REF\.?)\b/i.test(line) ? 2 : 1;
            candidates.push({value, source: lines.slice(i, consumed + 1).join("\n"), priority});
            i = consumed;
          }
        }
        i++;
      }
      const best = [];
      const priority = Math.min(...candidates.map(item => item.priority));
      for (const item of candidates) {
        if (item.priority === priority && !best.some(x => controlNumberKey(x.value) === controlNumberKey(item.value))) best.push(item);
      }
      return { subject, controlNo: best.length === 1 ? best[0].value : "", extractionVersion: "header-v2",
        fieldEvidence: {subject: subjectSource, controlNo: best.length === 1 ? best[0].source : ""},
        controlNoCandidates: best.map(item => item.value),
        needsReview: [...(!subject ? ["subject"] : []), ...(best.length !== 1 ? ["controlNo"] : [])] };
    }

    function extractSubjectOnly(text = "") { return parseHeaderFields(text).subject; }

    function parseOfficialDocument(rawText = "", serverMetadata = null) {
      const text = String(rawText || "")
        .replace(/\r/g, "")
        .replace(/\u00A0/g, " ");
      const lines = getNormalizedLines(text);
      const localFields = parseHeaderFields(text);
      const metadata = serverMetadata && typeof serverMetadata === "object" ? serverMetadata : {};
      // Control ambiguity remains authoritative; a blank server subject must
      // never suppress a clearly labeled subject present in the returned text.
      const fields = metadata.extractionVersion === "header-v2" ? metadata : localFields;
      const serverSubject = typeof metadata.subject === "string" && metadata.subject.trim()
        ? extractSubjectOnly(SUBJECT_RE.test(metadata.subject.split(/\r?\n/, 1)[0]) ? metadata.subject : `SUBJECT: ${metadata.subject}`) : "";
      const detectedSubject = serverSubject || localFields.subject;
      const subjectEvidence = serverSubject
        ? metadata.fieldEvidence?.subject || `SUBJECT: ${serverSubject}`
        : localFields.fieldEvidence.subject;

      const result = {
        type: "",
        documentType: detectDocumentTypeUniversal(text, lines),
        controlNo: "",
        date: "",
        office: "",
        sourceOffice: extractSourceOffice(text, lines),
        recipient: extractRecipient(text, lines),
        subject: detectedSubject,
        fieldEvidence: {...(fields.fieldEvidence || {}), subject: subjectEvidence},
        needsReview: [...(fields.needsReview || []).filter(field => field !== "subject"), ...(!detectedSubject ? ["subject"] : [])],
        controlNoCandidates: fields.controlNoCandidates || [],
        status: "",
        actionTaken: "",
        remarks: ""
      };

      // Direction and status are only filled when the header says so.
      const headerText = lines.slice(0, 40).join("\n");
      const explicitType = findExplicitField(headerText, ["COMMUNICATION TYPE", "TYPE"]);
      if (/^incoming\b/i.test(explicitType) ||
          /(?:^|\n)\s*(?:DATE\s+RECEIVED|RECEIVED\s+FROM|INCOMING\s+COMMUNICATION)\b/i.test(headerText)) {
        result.type = "Incoming";
        result.status = "Received";
      } else if (/^outgoing\b/i.test(explicitType) ||
          /(?:^|\n)\s*(?:DATE\s+RELEASED|RELEASED\s+TO|OUTGOING\s+COMMUNICATION)\b/i.test(headerText)) {
        result.type = "Outgoing";
        result.status = "Released";
      }
      const explicitStatus = findExplicitField(headerText, ["STATUS"]);
      const knownStatus = ["Pending", "Received", "Forwarded", "Released", "Archived"]
        .find(status => status.toLowerCase() === explicitStatus.toLowerCase());
      if (knownStatus) result.status = knownStatus;

      result.controlNo = normalizeControlNumber(fields.controlNo);

      // Date: prefer an explicit DATE field, otherwise only search the top 20 lines.
      const explicitDate = findExplicitField(headerText, ["DATE", "DATE RECEIVED", "DATE RELEASED", "DATED"]);
      result.date = parseDateValue(explicitDate);

      if (!result.date) {
        const standaloneDate = lines.slice(0, 20).find(line =>
          /^(?:\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{1,2}-\d{1,2})$/.test(line)
        );
        result.date = parseDateValue(standaloneDate);
      }

      result.actionTaken = findExplicitField(headerText, ["ACTION TAKEN", "DATE FORWARDED"]);
      result.remarks = findExplicitField(headerText, ["REMARKS"]);

      // Preserve the document's wording; do not rewrite its subject.
      if (!result.sourceOffice && metadata.sourceOffice) {
        result.sourceOffice = cleanOfficeName(metadata.sourceOffice);
      }
      if (!result.recipient && metadata.recipient) {
        result.recipient = cleanOfficeName(metadata.recipient);
      }
      // The Office field follows the header: sender for incoming, addressee
      // for outgoing, then the letterhead when no addressee is present.
      // A signature never supplies the Office field.
      result.office = result.type === "Incoming"
        ? (result.sourceOffice || result.recipient)
        : (result.recipient || result.sourceOffice);

      return result;
    }

    const lastOcrValues = {};
    let lastDetectedFields = null;
    if (controlNoInput) {
      controlNoInput.readOnly = false;
      controlNoInput.disabled = false;
      controlNoInput.removeAttribute("maxlength");
      controlNoInput.required = true;
      controlNoInput.placeholder = "Control number printed in the document header";
      controlNoInput.title = "Detected from the header. Verify or enter the exact printed number.";
    }
    subjectInput?.removeAttribute("maxlength");

    function applyDetectedOcrValue(element, value, eventName = "input") {
      if (!element) return;
      const detected = String(value || "").trim();
      const previous = lastOcrValues[element.id];
      if (detected && element.tagName === "SELECT" &&
          !Array.from(element.options).some(option => option.value === detected)) return;
      if (detected) {
        element.value = detected;
        lastOcrValues[element.id] = detected;
      } else if (previous !== undefined) {
        // Remove a value supplied by an earlier scan, preserving manual edits.
        if (element.value === previous) element.value = "";
        delete lastOcrValues[element.id];
      } else {
        return;
      }
      element.dispatchEvent(new Event(eventName, { bubbles: true }));
    }

    function autofillCommunicationFields(extractedText, serverMetadata = null) {
      ensureDocumentTypeOptions();

      const parsed = parseOfficialDocument(extractedText, serverMetadata);

      applyDetectedOcrValue(typeSelect, parsed.type, "change");
      // A fresh scan replaces stale fields even when the new field is unreadable.
      if (controlNoInput) {
        controlNoInput.value = parsed.controlNo || "";
        lastOcrValues[controlNoInput.id] = controlNoInput.value;
        controlNoInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      lastDetectedFields = parsed;
      applyDetectedOcrValue(docTypeSelect, parsed.documentType, "change");
      applyDetectedOcrValue(dateInput, parsed.date);
      applyDetectedOcrValue(statusSelect, parsed.status, "change");
      applyDetectedOcrValue(officeInput, parsed.office);
      // Write only the text following SUBJECT into the actual subject textarea.
      if (subjectInput) {
        subjectInput.value = parsed.subject || "";
        lastOcrValues[subjectInput.id] = subjectInput.value;
        subjectInput.dispatchEvent(new Event("input", { bubbles: true }));
        subjectInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      applyDetectedOcrValue(actionTakenInput, parsed.actionTaken);
      applyDetectedOcrValue(remarksInput, parsed.remarks);

      return parsed;
    }

    // Refill the subject when the user corrects the extracted OCR text.
    ocrTextInput?.addEventListener("input", () => {
      if (!subjectInput) return;
      const detected = extractSubjectOnly(ocrTextInput.value);
      if (detected && (!subjectInput.value.trim() || subjectInput.value === lastOcrValues[subjectInput.id])) {
        subjectInput.value = detected;
        lastOcrValues[subjectInput.id] = detected;
        subjectInput.dispatchEvent(new Event("input", { bubbles: true }));
        subjectInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    ensureDocumentTypeOptions();

    /* ---------------- 8. OCR CLIENT ENGINE ---------------- */
    async function checkOcrServer() {
      try {
        const response = await fetch(`${OCR_SERVER_URL}/health`, {
          method: "GET",
          cache: "no-store",
          signal: AbortSignal.timeout(3000)
        });
        if (!response.ok) return false;
        const result = await response.json();
        return Boolean(result?.ok);
      } catch {
        return false;
      }
    }

    async function extractTextWithServer(file) {
      if (!file) {
        throw new Error("Please choose a document first.");
      }

      setUploadProgress(
        15,
        "Processing OCR..."
      );

      const serverOnline = await checkOcrServer();

      if (!serverOnline) {
        const ext = getFileExtension(file.name);

        if (ext === "txt" || ext === "csv") {
          setUploadProgress(
            50,
            "Reading local text file..."
          );

          const text = await file.text();

          setUploadProgress(
            100,
            "Text read successfully."
          );

          return {
            text: text.trim(),
            metadata: {}
          };
        }

        throw new Error(
          "PGENRO OCR Server is offline. Please start it by running: python OCR.py"
        );
      }

      setUploadProgress(
        35,
        `Scanning ${file.name}...`
      );

      const formData = new FormData();
      formData.append("file", file, file.name);

      let response;

      try {
        response = await fetch(
          `${OCR_SERVER_URL}/ocr`,
          {
            method: "POST",
            body: formData
          }
        );
      } catch {
        throw new Error(
          "Cannot connect to PGENRO OCR Server at http://127.0.0.1:5000"
        );
      }

      setUploadProgress(
        75,
        "Analyzing source office, subject and document particulars..."
      );

      let result;

      try {
        result = await response.json();
      } catch {
        throw new Error(
          "OCR Server returned an invalid response."
        );
      }

      if (!response.ok || !result.success) {
        throw new Error(
          result?.error ||
          `OCR processing failed with status ${response.status}.`
        );
      }

      const text = String(
        result?.text || ""
      ).trim();

      if (!text) {
        throw new Error(
          "Document was scanned, but no readable text was detected."
        );
      }

      setUploadProgress(
        100,
        "Document extracted successfully."
      );

      return {
        text,
        metadata: result?.metadata || {}
      };
    }

    let ocrRunToken = 0;
    let ocrBusy = false;

    function setOcrButtonState(reading = false) {
      if (!runOcrBtn) return;
      runOcrBtn.disabled = reading || !selectedFile;

      if (reading) {
        runOcrBtn.innerHTML = `<i data-lucide="loader-2" class="spin-icon"></i><span>Reading Document...</span>`;
        if (ocrActionSubtext) ocrActionSubtext.textContent = "OCR is running automatically. Please wait...";
      } else {
        runOcrBtn.innerHTML = `<i data-lucide="scan-text"></i><span>Run OCR Text Reader</span>`;
        if (ocrActionSubtext) {
          ocrActionSubtext.textContent = selectedFile
            ? "OCR completed automatically. Click to re-scan."
            : "Select a document to extract OCR text.";
        }
      }
      refreshIcons();
    }

    async function runAutomaticOcr(file) {
      if (!file) return;

      const currentToken = ++ocrRunToken;
      ocrBusy = true;
      setOcrButtonState(true);

      try {
        setUploadProgress(
          10,
          `Preparing ${file.name}...`
        );

        const extracted = await extractTextWithServer(file);
        const extractedText = String(
          extracted?.text || ""
        ).trim();
        const serverMetadata = extracted?.metadata || {};

        if (
          currentToken !== ocrRunToken ||
          file !== selectedFile
        ) {
          return;
        }

        if (!extractedText) {
          throw new Error(
            "Document was scanned, but no readable text was detected."
          );
        }

        if (ocrTextInput) {
          ocrTextInput.value = extractedText;
          ocrTextInput.dispatchEvent(
            new Event("input", { bubbles: true })
          );

          if (ocrStatsChip) {
            ocrStatsChip.style.display = "inline-flex";
            ocrStatsChip.textContent =
              `${extractedText.length.toLocaleString()} characters extracted`;
          }
        }

        const detected = autofillCommunicationFields(
          extractedText,
          serverMetadata
        );

        const filled = [
          detected.sourceOffice &&
            `Source: ${detected.sourceOffice}`,
          detected.recipient &&
            `To: ${detected.recipient}`,
          detected.controlNo &&
            `Control No: ${detected.controlNo}`,
          detected.subject &&
            `Subject: ${detected.subject}`,
          detected.date &&
            `Date: ${detected.date}`
        ].filter(Boolean);

        const missing = [];
        if (!detected.subject) missing.push("Subject");
        if (!detected.controlNo) missing.push("Control No.");
        const duplicate = detected.controlNo && records.some(record =>
          controlNumberKey(record.controlNo) === controlNumberKey(detected.controlNo)
          && String(record.id) !== String(editIndexInput?.value !== "" ? records[Number(editIndexInput?.value)]?.id || "" : "")
        );
        showToast(duplicate
          ? `Control number ${detected.controlNo} already exists. Open the existing record.`
          : missing.length
            ? `OCR complete. Check the header and enter ${missing.join(" and ")}.${detected.controlNoCandidates.length > 1 ? " Multiple header numbers were found." : ""}`
            : `Extracted: ${filled.join(" | ")}`,
          duplicate || missing.length ? "warning" : "success");
      } catch (error) {
        if (currentToken !== ocrRunToken || file !== selectedFile) return;
        console.error("OCR Error:", error);
        setUploadProgress(
          0,
          "OCR scan failed."
        );
        showToast(
          error.message || "Failed to read document.",
          "error"
        );
      } finally {
        if (currentToken === ocrRunToken) {
          ocrBusy = false;
          setOcrButtonState(false);
        }
      }
    }

    runOcrBtn?.addEventListener("click", async (e) => {
      e.preventDefault();
      const file = selectedFile || documentFileInput?.files?.[0];
      if (file) await runAutomaticOcr(file);
    });

    /* ---------------- 9. LIVE PREVIEW & FILE ATTACHMENT ---------------- */
    function clearPreviewBlob() {
      if (activePreviewBlobUrl) {
        URL.revokeObjectURL(activePreviewBlobUrl);
        activePreviewBlobUrl = null;
      }
    }

    function renderFilePreview(file, fallbackUrl = "") {
      if (!filePreviewContainer || !filePreviewBody) return;
      clearPreviewBlob();

      if (!file && !fallbackUrl) {
        filePreviewContainer.style.display = "none";
        filePreviewBody.innerHTML = "";
        if (previewOpenExternalBtn) previewOpenExternalBtn.style.display = "none";
        return;
      }

      filePreviewContainer.style.display = "block";
      const filename = file ? file.name : (existingEditFileName || "Document");
      const ext = getFileExtension(filename);

      if (file) {
        activePreviewBlobUrl = URL.createObjectURL(file);
      }
      const activeUrl = activePreviewBlobUrl || fallbackUrl;

      if (previewOpenExternalBtn) {
        if (activeUrl) {
          previewOpenExternalBtn.href = activeUrl;
          previewOpenExternalBtn.style.display = "inline-flex";
        } else {
          previewOpenExternalBtn.style.display = "none";
        }
      }

      if (previewBadge) previewBadge.textContent = ext.toUpperCase() || "ATTACHMENT";

      if (["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"].includes(ext)) {
        filePreviewBody.innerHTML = `
          <div class="image-preview-wrapper">
            <img src="${escapeHtml(activeUrl)}" alt="Preview" class="file-preview-image"/>
            <div class="preview-caption">
              <span>${escapeHtml(filename)}</span>
              ${file ? `<span>(${formatFileSize(file.size)})</span>` : ""}
            </div>
          </div>
        `;
        refreshIcons();
        return;
      }

      if (ext === "pdf") {
        filePreviewBody.innerHTML = `
          <div class="pdf-preview-wrapper">
            <iframe src="${escapeHtml(activeUrl)}#toolbar=0" class="file-preview-iframe" title="PDF Viewer"></iframe>
            <div class="preview-caption">
              <span><i data-lucide="file-text"></i> ${escapeHtml(filename)}</span>
              <a href="${escapeHtml(activeUrl)}" target="_blank" rel="noopener noreferrer" class="preview-link">
                Open in new tab <i data-lucide="external-link"></i>
              </a>
            </div>
          </div>
        `;
        refreshIcons();
        return;
      }

      let docIcon = "file-text";
      if (ext === "xlsx" || ext === "csv") docIcon = "file-spreadsheet";
      if (ext === "pptx") docIcon = "presentation";

      filePreviewBody.innerHTML = `
        <div class="document-preview-card">
          <div class="doc-preview-icon"><i data-lucide="${docIcon}"></i></div>
          <div class="doc-preview-info">
            <strong>${escapeHtml(filename)}</strong>
            <p>${ext.toUpperCase()} File • ${file ? formatFileSize(file.size) : "Ready for OCR"}</p>
            <span class="preview-note"><i data-lucide="circle-check"></i> Document verified. Downloadable directly upon saving.</span>
          </div>
        </div>
      `;
      refreshIcons();
    }

    function updateFileUI(file = null, existingName = "") {
      const hasFile = Boolean(file);
      const hasExisting = Boolean(existingName);

      filePickerState?.classList.toggle("has-file", hasFile || hasExisting);

      if (fileNameDisplay) {
        fileNameDisplay.textContent = hasFile ? file.name : (hasExisting ? existingName : "Choose a document file");
      }

      if (fileMetaDisplay) {
        if (hasFile) {
          fileMetaDisplay.textContent = `${getFileExtension(file.name).toUpperCase()} • ${formatFileSize(file.size)} • Ready for OCR`;
        } else if (hasExisting) {
          fileMetaDisplay.textContent = "Current registered document";
        } else {
          fileMetaDisplay.textContent = "PDF, PNG, JPG, JPEG, WEBP, DOCX, TXT • Max 50 MB";
        }
      }

      if (filePickerIcon) {
        const ext = hasFile ? getFileExtension(file.name) : getFileExtension(existingName);
        filePickerIcon.innerHTML = `<i data-lucide="${(hasFile || hasExisting) ? getFileIcon(ext) : "file-up"}"></i>`;
      }

      if (runOcrBtn) {
        runOcrBtn.disabled = !hasFile;
      }

      if (removeDocumentBtn) {
        removeDocumentBtn.style.display = hasFile ? "inline-flex" : "none";
      }

      if (hasFile) {
        renderFilePreview(file);
      } else if (hasExisting && existingEditDriveLink) {
        renderFilePreview(null, existingEditDriveLink);
      } else {
        renderFilePreview(null);
      }

      refreshIcons();
    }

    browseDocumentBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      documentFileInput?.click();
    });

    removeDocumentBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      selectedFile = null;
      ocrRunToken += 1;
      ocrBusy = false;
      lastDetectedFields = null;
      if (documentFileInput) documentFileInput.value = "";
      updateFileUI(null, existingEditFileName);
      resetProgress();
      setOcrButtonState(false);
    });

    async function acceptSelectedDocument(file) {
      if (!file) return;
      const validation = validateFile(file);
      if (validation) {
        selectedFile = null;
        if (documentFileInput) documentFileInput.value = "";
        updateFileUI(null, existingEditFileName);
        showToast(validation, "error");
        return;
      }

      selectedFile = file;
      lastDetectedFields = null;
      if (controlNoInput) controlNoInput.value = "";
      if (subjectInput) subjectInput.value = "";
      if (ocrTextInput) ocrTextInput.value = "";
      updateFileUI(file);
      resetProgress();
      showToast(`Document selected. Running smart OCR...`, "success");
      await runAutomaticOcr(file);
    }

    documentFileInput?.addEventListener("change", async (event) => {
      await acceptSelectedDocument(event.target.files?.[0] || null);
    });

    // Drag-and-drop support for the visible upload workspace.
    ["dragenter", "dragover"].forEach(eventName => {
      filePickerState?.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        filePickerState.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach(eventName => {
      filePickerState?.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        filePickerState.classList.remove("is-dragover");
      });
    });
    filePickerState?.addEventListener("drop", async (event) => {
      const file = event.dataTransfer?.files?.[0] || null;
      if (file) await acceptSelectedDocument(file);
    });

    function setUploadProgress(percent, message) {
      const val = Math.max(0, Math.min(100, Number(percent) || 0));
      if (encodingUploadProgressBox) encodingUploadProgressBox.style.display = "flex";
      if (encodingProgressBar) encodingProgressBar.style.width = `${val}%`;
      if (encodingUploadStatusText) encodingUploadStatusText.textContent = message || "Processing...";
    }

    function resetProgress() {
      if (encodingUploadProgressBox) encodingUploadProgressBox.style.display = "none";
      if (encodingProgressBar) encodingProgressBar.style.width = "0%";
      if (encodingUploadStatusText) encodingUploadStatusText.textContent = "Ready";
    }

    function getFileExtension(filename = "") {
      return filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
    }

    function formatFileSize(bytes = 0) {
      if (!bytes) return "0 B";
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    function validateFile(file) {
      if (!file) return "";
      const ext = getFileExtension(file.name);
      if (!SUPPORTED_DOCUMENT_TYPES.has(ext)) {
        return "Unsupported format. Use PDF, Images (PNG/JPG), Word, Excel, or Text.";
      }
      if (file.size > MAX_FILE_SIZE) return "File exceeds 50 MB limit.";
      return "";
    }

    function getFileIcon(ext) {
      if (ext === "pdf") return "file-text";
      if (["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"].includes(ext)) return "file-image";
      if (ext === "docx" || ext === "doc") return "file-text";
      if (ext === "xlsx" || ext === "csv") return "file-spreadsheet";
      if (ext === "pptx") return "presentation";
      return "file";
    }

    /* ---------------- 10. TABLE RENDERING ---------------- */
    function renderRecords() {
      if (!communicationTableBody) return;
      const filtered = getFilteredRecords();
      communicationTableBody.closest(".table-responsive")?.classList.toggle("is-empty", filtered.length === 0);
      updateKPIs();
      updateNotifications();

      // Remove stale selections when records were deleted or reloaded.
      const validKeys = new Set(records.map((record, index) => getRecordKey(record, index)));
      [...selectedRecordIds].forEach(key => { if (!validKeys.has(key)) selectedRecordIds.delete(key); });

      if (filtered.length === 0) {
        communicationTableBody.innerHTML = `
          <tr>
            <td colspan="8" class="empty-table-cell">
              <div class="records-empty-state">
                <span class="records-empty-icon"><i data-lucide="file-text"></i></span>
                <strong>${records.length ? "No matching records" : "No communications yet"}</strong>
                <span>${records.length ? "Try another search or adjust the filters." : "Select New Communication to encode your first document."}</span>
              </div>
            </td>
          </tr>
        `;
        if (tablePaginationInfo) tablePaginationInfo.textContent = "Showing 0 entries";
        updateSelectionUI(filtered);
        refreshIcons();
        return;
      }

      communicationTableBody.innerHTML = filtered.map(record => {
        const index = records.indexOf(record);
        const recordKey = getRecordKey(record, index);
        const isSelected = selectedRecordIds.has(recordKey);
        let fileMarkup = `<span class="text-muted">No attachment</span>`;

        if (record.fileName) {
          fileMarkup = `
            <div class="file-cell-wrapper">
              <span class="file-name-meta" title="${escapeHtml(record.fileName)}">
                <i data-lucide="${getFileIcon(getFileExtension(record.fileName))}"></i>
                <span>${escapeHtml(record.fileName)}</span>
              </span>
              <div class="file-cell-actions">
                <button type="button" class="btn-file-pill view-pill" data-action="view-doc" data-index="${index}" title="Preview Document">
                  <i data-lucide="eye"></i> View
                </button>
                <button type="button" class="btn-file-pill download-pill" data-action="download-doc" data-index="${index}" title="Download Soft Copy">
                  <i data-lucide="download"></i> Download
                </button>
              </div>
            </div>
          `;
        }

        const type = record.type || "—";
        const documentType = record.documentType || "Document";
        const date = record.date || "—";
        const office = record.office || "—";
        const subject = record.subject || "—";
        const status = record.status || "Pending";

        return `
          <tr data-record-id="${escapeHtml(record.id ?? index)}" class="${isSelected ? "is-selected" : ""}">
            <td>
              <input type="checkbox" class="row-checkbox" value="${index}" data-record-key="${escapeHtml(recordKey)}" aria-label="Select ${escapeHtml(record.controlNo || "communication record")}" ${isSelected ? "checked" : ""}>
            </td>
            <td>
              <strong>${escapeHtml(record.controlNo || "N/A")}</strong>
              <div style="margin-top:4px; font-size:10px; color:#64748b;">
                ${escapeHtml(type)} &bull; ${escapeHtml(documentType)}
              </div>
            </td>
            <td>${escapeHtml(date)}</td>
            <td>${escapeHtml(office)}</td>
            <td style="max-width:260px; white-space:normal;">${escapeHtml(subject)}</td>
            <td>${fileMarkup}</td>
            <td>
              <span class="badge status-badge ${getStatusClass(status)}">
                ${escapeHtml(status)}
              </span>
            </td>
            <td style="text-align:right; white-space:nowrap;">
              <button type="button" class="btn-action" data-action="edit" data-index="${index}" title="Edit Record">
                <i data-lucide="pencil"></i>
              </button>
              <button type="button" class="btn-action" data-action="ocr" data-index="${index}" title="View OCR Text">
                <i data-lucide="file-scan"></i>
              </button>
              <button type="button" class="btn-action delete" data-action="delete" data-index="${index}" title="Delete Record">
                <i data-lucide="trash-2"></i>
              </button>
            </td>
          </tr>
        `;
      }).join("");

      if (tablePaginationInfo) {
        tablePaginationInfo.textContent = `Showing ${filtered.length} of ${records.length} total entries`;
      }
      updateSelectionUI(filtered);
      refreshIcons();
    }

    function getRecordKey(record, index = -1) {
      return String(record?.id || record?.controlNo || `row-${index}`);
    }

    function updateSelectionUI(filtered = getFilteredRecords()) {
      const visibleKeys = filtered.map((record) => getRecordKey(record, records.indexOf(record)));
      const selectedVisible = visibleKeys.filter(key => selectedRecordIds.has(key)).length;

      if (selectAllRows) {
        selectAllRows.checked = visibleKeys.length > 0 && selectedVisible === visibleKeys.length;
        selectAllRows.indeterminate = selectedVisible > 0 && selectedVisible < visibleKeys.length;
        selectAllRows.setAttribute("aria-label", selectedVisible ? `${selectedVisible} visible records selected` : "Select all visible records");
      }

      const totalSelected = selectedRecordIds.size;
      if (bulkSelectionBar) bulkSelectionBar.hidden = totalSelected === 0;
      if (selectedCountText) selectedCountText.textContent = `${totalSelected} record${totalSelected === 1 ? "" : "s"} selected`;
    }

    function clearSelection() {
      selectedRecordIds.clear();
      renderRecords();
    }

    function updateNotifications() {
      if (!notificationList) return;
      const pending = records
        .map((record, index) => ({ record, index }))
        .filter(({ record }) => String(record.status || "").toLowerCase() === "pending")
        .slice(0, 8);

      if (notifBadgeCount) notifBadgeCount.textContent = `${pending.length} Pending`;
      if (notifPing) notifPing.style.display = pending.length ? "block" : "none";

      if (!pending.length) {
        notificationList.innerHTML = `<div class="empty-notif-state">No pending communication actions</div>`;
        return;
      }

      notificationList.innerHTML = pending.map(({ record, index }) => `
        <button type="button" class="communication-notification-item" data-notification-index="${index}">
          <span class="communication-notification-icon"><i data-lucide="clock-3"></i></span>
          <span class="communication-notification-copy">
            <strong>${escapeHtml(record.controlNo || "Pending communication")}</strong>
            <span>${escapeHtml(record.subject || record.documentType || "Requires action")}</span>
            <small>${escapeHtml(record.office || "PGENRO")}</small>
          </span>
        </button>
      `).join("");
      refreshIcons();
    }

    function csvEscape(value) {
      return `"${String(value ?? "").replaceAll('"', '""')}"`;
    }

    function exportFilteredRecords() {
      const filtered = getFilteredRecords();
      if (!filtered.length) {
        showToast("There are no communication records to export.", "warning");
        return;
      }
      const headers = ["Control No.", "Type", "Document Type", "Date", "Office / Recipient", "Subject", "Status", "Action Taken", "Remarks", "File Name"];
      const lines = [headers, ...filtered.map(record => [
        record.controlNo, record.type, record.documentType, record.date, record.office,
        record.subject, record.status, record.actionTaken || record.dateForwarded,
        record.remarks, record.fileName
      ])].map(row => row.map(csvEscape).join(","));
      const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pgenro_communications_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(`Exported ${filtered.length} communication record${filtered.length === 1 ? "" : "s"}.`, "success");
    }

    async function syncCommunications() {
      if (!syncCommunicationsBtn) return;
      const original = syncCommunicationsBtn.innerHTML;
      syncCommunicationsBtn.disabled = true;
      syncCommunicationsBtn.innerHTML = `<i data-lucide="loader-2" class="spin-icon"></i><span>Syncing...</span>`;
      refreshIcons();
      try {
        await loadRecords();
        showToast(cloudRecordsAvailable ? "Communications synced with Supabase." : "Local communication cache refreshed.", cloudRecordsAvailable ? "success" : "warning");
      } catch (error) {
        console.error("Manual sync failed:", error);
        showToast("Could not refresh communications right now.", "error");
      } finally {
        syncCommunicationsBtn.disabled = false;
        syncCommunicationsBtn.innerHTML = original;
        refreshIcons();
      }
    }

    async function archiveSelectedRecords() {
      const keys = new Set(selectedRecordIds);
      if (!keys.size) return;
      const targets = records.filter((record, index) => keys.has(getRecordKey(record, index)));
      if (!targets.length) return clearSelection();

      bulkArchiveBtn && (bulkArchiveBtn.disabled = true);
      try {
        for (const record of targets) {
          const updated = { ...record, status: "Archived" };
          if (supabaseConfigured) await saveRecordToCloud(updated);
          const index = records.indexOf(record);
          if (index >= 0) records[index] = updated;
        }
        saveLocalRecords();
        selectedRecordIds.clear();
        renderRecords();
        showToast(`${targets.length} record${targets.length === 1 ? "" : "s"} archived.`, "success");
      } catch (error) {
        console.error("Bulk archive failed:", error);
        showToast("Bulk archive could not be completed. No additional records were changed.", "error");
        await loadRecords();
      } finally {
        if (bulkArchiveBtn) bulkArchiveBtn.disabled = false;
      }
    }

    async function deleteSelectedRecords() {
      const keys = new Set(selectedRecordIds);
      if (!keys.size) return;
      const targets = records.filter((record, index) => keys.has(getRecordKey(record, index)));
      if (!targets.length) return clearSelection();
      if (!confirm(`Delete ${targets.length} selected communication record${targets.length === 1 ? "" : "s"}? This cannot be undone.`)) return;

      bulkDeleteBtn && (bulkDeleteBtn.disabled = true);
      try {
        for (const record of targets) {
          if (supabaseConfigured && record.id) await deleteRecordFromCloud(record.id);
          if (record.id) await deleteStoredFile(record.id);
          if (record.controlNo) await deleteStoredFile(record.controlNo);
        }
        records = records.filter((record, index) => !keys.has(getRecordKey(record, index)));
        saveLocalRecords();
        selectedRecordIds.clear();
        renderRecords();
        showToast(`${targets.length} record${targets.length === 1 ? "" : "s"} deleted.`, "success");
      } catch (error) {
        console.error("Bulk delete failed:", error);
        showToast("Bulk delete stopped because a cloud operation failed. Records were refreshed.", "error");
        await loadRecords();
      } finally {
        if (bulkDeleteBtn) bulkDeleteBtn.disabled = false;
      }
    }

    function getStatusClass(status) {
      const val = String(status || "").toLowerCase();
      if (val === "received" || val === "released") return "success";
      if (val === "pending") return "amber";
      if (val === "forwarded") return "info";
      return "neutral";
    }

    function getFilteredRecords() {
      const tableSearch = (tableSearchInput?.value || "").trim().toLowerCase();
      const globalSearch = (globalSearchInput?.value || "").trim().toLowerCase();
      const search = tableSearch || globalSearch;

      return records.filter(record => {
        const matchesType = currentTypeFilter === "All" || String(record.type || "").toLowerCase() === currentTypeFilter.toLowerCase();
        const matchesStatus = currentStatusFilter === "All" || String(record.status || "").toLowerCase() === currentStatusFilter.toLowerCase();

        const searchable = [
          record.controlNo, record.type, record.documentType, record.date,
          record.office, record.subject, record.status, record.fileName,
          record.ocrText
        ].filter(Boolean).join(" ").toLowerCase();

        return matchesType && matchesStatus && (!search || searchable.includes(search));
      });
    }

    function updateKPIs() {
      const total = records.length;
      const incoming = records.filter(r => String(r.type || "").toLowerCase() === "incoming").length;
      const outgoing = records.filter(r => String(r.type || "").toLowerCase() === "outgoing").length;
      const pending = records.filter(r => String(r.status || "").toLowerCase() === "pending").length;

      if (kpiTotalRecords) kpiTotalRecords.textContent = total.toLocaleString();
      if (kpiIncomingCount) kpiIncomingCount.textContent = incoming.toLocaleString();
      if (kpiOutgoingCount) kpiOutgoingCount.textContent = outgoing.toLocaleString();
      if (kpiPendingCount) kpiPendingCount.textContent = pending.toLocaleString();
    }

    /* ---------------- 11. DOWNLOAD & VIEWER ---------------- */
    async function downloadRecordFile(index) {
      const record = records[index];
      if (!record || !record.fileName) {
        showToast("No attached document for this record.", "warning");
        return;
      }

      showToast(`Preparing download for ${record.fileName}...`, "info");

      const stored = await getStoredFile(record.id || record.controlNo);
      if (stored && stored.blob) {
        triggerBrowserDownload(stored.blob, record.fileName);
        return;
      }

      if (record.driveLink) {
        const a = document.createElement("a");
        a.href = record.driveLink;
        a.download = record.fileName;
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast(`Download started: ${record.fileName}`, "success");
        return;
      }

      showToast("File data not found in local cache.", "error");
    }

    function triggerBrowserDownload(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 1000);
      showToast(`Downloaded: ${filename}`, "success");
    }

    async function viewDocument(index) {
      const record = records[index];
      if (!record || !record.fileName || !viewDocumentModal) return;

      if (docViewerTitle) docViewerTitle.textContent = record.fileName;
      if (docViewerSubtitle) docViewerSubtitle.textContent = `${record.controlNo || "Doc"} • ${record.documentType || "Communication"}`;

      if (docViewerIframe) docViewerIframe.style.display = "none";
      if (docViewerImage) docViewerImage.style.display = "none";
      if (docViewerFallback) docViewerFallback.style.display = "none";

      let fileBlob = null;
      const stored = await getStoredFile(record.id || record.controlNo);
      if (stored && stored.blob) {
        fileBlob = stored.blob;
      }

      const ext = getFileExtension(record.fileName);
      const fileUrl = fileBlob ? URL.createObjectURL(fileBlob) : (record.driveLink || "");

      if (docViewerDownloadBtn) {
        docViewerDownloadBtn.onclick = (e) => {
          e.preventDefault();
          downloadRecordFile(index);
        };
      }

      if (docViewerExternalBtn) {
        if (fileUrl) {
          docViewerExternalBtn.href = fileUrl;
          docViewerExternalBtn.style.display = "inline-flex";
        } else {
          docViewerExternalBtn.style.display = "none";
        }
      }

      if (ext === "pdf" && fileUrl) {
        docViewerIframe.src = `${fileUrl}#toolbar=1`;
        docViewerIframe.style.display = "block";
      } else if (["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"].includes(ext) && fileUrl) {
        docViewerImage.src = fileUrl;
        docViewerImage.style.display = "block";
      } else {
        docViewerFallback.innerHTML = `
          <div style="padding: 30px; text-align: center;">
            <i data-lucide="${getFileIcon(ext)}" style="width: 48px; height: 48px; color: #059669; margin-bottom: 12px;"></i>
            <h3>${escapeHtml(record.fileName)}</h3>
            <p style="color: #94a3b8; font-size: 13px;">Direct preview is not supported for .${ext} files.</p>
            <button type="button" class="btn btn-primary" id="fallbackDownloadBtn" style="margin-top: 15px;">
              <i data-lucide="download"></i> Download File to View
            </button>
          </div>
        `;
        docViewerFallback.style.display = "block";
        $("#fallbackDownloadBtn", docViewerFallback)?.addEventListener("click", () => {
          downloadRecordFile(index);
        });
        refreshIcons();
      }

      viewDocumentModal.classList.add("open");
      viewDocumentModal.setAttribute("aria-hidden", "false");
      document.body.classList.add("admin-modal-open");
      refreshIcons();
    }

    closeDocViewerBtn?.addEventListener("click", () => {
      viewDocumentModal?.classList.remove("open");
      viewDocumentModal?.setAttribute("aria-hidden", "true");
      document.body.classList.remove("admin-modal-open");
      if (docViewerIframe) docViewerIframe.src = "";
      if (docViewerImage) docViewerImage.src = "";
    });

    /* ---------------- 12. SAVE RECORD ---------------- */
    let savingRecord = false;
    async function saveCommunicationRecord(event) {
      event.preventDefault();
      if (savingRecord) return;
      if (ocrBusy) { showToast("Please wait for OCR to finish before saving.", "warning"); return; }
      if (!typeSelect?.value || !docTypeSelect?.value || !dateInput?.value ||
          !statusSelect?.value || !officeInput?.value.trim() || !subjectInput?.value.trim()) {
        communicationForm?.reportValidity();
        showToast("Please fill in all required fields (*).", "warning"); return;
      }
      const controlNo = normalizeControlNumber(controlNoInput?.value);
      if (!controlNo || !/\d/.test(controlNo)) {
        showToast("Check the document header and enter its printed control number. No number will be generated.", "warning");
        controlNoInput?.focus(); return;
      }
      const editIndex = editIndexInput?.value ?? "";
      const editing = editIndex !== "";
      const existing = editing ? records[Number(editIndex)] : null;
      if (editing && !existing) { showToast("Record no longer available. Refresh the list.", "warning"); return; }
      const recordId = existing?.id || (crypto.randomUUID?.() || `communication-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const fileToSave = selectedFile;
      const recordPayload = {
        id: recordId, controlNo,
        type: typeSelect.value, documentType: docTypeSelect.value, date: dateInput.value,
        status: statusSelect.value, office: officeInput.value.trim(), subject: subjectInput.value.trim(),
        actionTaken: actionTakenInput?.value.trim() || null,
        dateForwarded: actionTakenInput?.value.trim() || null,
        remarks: remarksInput?.value.trim() || null, ocrText: ocrTextInput?.value.trim() || null,
        fileName: fileToSave?.name || existing?.fileName || null,
        fileSize: Number(fileToSave?.size || existing?.fileSize || 0) || null,
        driveLink: existing?.driveLink || null,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ocrDetection: lastDetectedFields ? {
          controlNo: lastDetectedFields.controlNo,
          subject: lastDetectedFields.subject,
          fieldEvidence: lastDetectedFields.fieldEvidence,
          controlNoCandidates: lastDetectedFields.controlNoCandidates,
          controlNoSource: controlNo === lastDetectedFields.controlNo ? "header" : "manual",
          subjectSource: subjectInput.value.trim() === lastDetectedFields.subject ? "header" : "manual"
        } : existing?.ocrDetection ? {
          ...existing.ocrDetection,
          controlNoSource: controlNo === existing.ocrDetection.controlNo ? "header" : "manual",
          subjectSource: subjectInput.value.trim() === existing.ocrDetection.subject ? "header" : "manual"
        } : {controlNoSource: "manual", subjectSource: "manual"}
      };
      savingRecord = true;
      setSaveButton(true, "Checking and saving record...");
      try {
        const persist = async () => {
          // Re-read the cache inside the cross-tab lock before checking duplicates.
          const cached = JSON.parse(localStorage.getItem("communicationRecords") || "[]");
          const pool = [...(Array.isArray(cached) ? cached : []), ...records];
          if (pool.some(record => String(record.id) !== String(recordId) &&
              controlNumberKey(record.controlNo) === controlNumberKey(controlNo))) {
            const error = new Error(`Control number ${controlNo} already exists. Open the existing record.`);
            error.code = "23505"; throw error;
          }
          // With Supabase configured, a rejected/failed cloud write is not saved locally.
          // The supplied unique index is authoritative for simultaneous users.
          const cloudSaved = await saveRecordToCloud(recordPayload);
          const merged = new Map(pool.map(record => [String(record.id || record.controlNo), record]));
          merged.set(String(recordId), { ...existing, ...recordPayload });
          const nextRecords = Array.from(merged.values());
          let cacheWarning = false;
          try { localStorage.setItem("communicationRecords", JSON.stringify(nextRecords)); }
          catch (error) { if (!cloudSaved) throw error; cacheWarning = true; }
          records = nextRecords;
          let fileWarning = false;
          if (fileToSave) {
            try {
              await storeFileLocally(recordId, fileToSave);
              await storeFileLocally(controlNo, fileToSave);
            } catch (error) { fileWarning = true; console.warn("Attachment save failed:", error); }
          }
          renderRecords();
          showToast(fileWarning ? "Record saved, but the attachment was not stored. Reattach it using Edit."
            : cacheWarning ? "Record saved to Supabase, but the browser cache could not be updated."
            : cloudSaved ? "Record saved and synced successfully." : "Record saved to this browser.",
            fileWarning || cacheWarning ? "warning" : "success");
          closeEncodingModal();
        };
        if (navigator.locks?.request) await navigator.locks.request("pgenro-communication-save", persist);
        else await persist();
      } catch (error) {
        console.error("Save error:", error);
        const duplicate = String(error.code) === "23505";
        showToast(duplicate ? `Control number ${controlNo} already exists. Record was not saved.`
          : `Save failed: ${error.message || "Check your connection and try again."}`, duplicate ? "warning" : "error");
        if (duplicate) controlNoInput?.focus();
      } finally {
        savingRecord = false;
        setSaveButton(false, editing ? "Update Record" : "Encode & Save Record");
      }
    }

    communicationForm?.addEventListener("submit", saveCommunicationRecord);

    function setSaveButton(loading, label) {
      if (!saveRecordBtn) return;
      saveRecordBtn.disabled = Boolean(loading);
      saveRecordBtn.innerHTML = loading
        ? `<i data-lucide="loader-2" class="spin-icon"></i><span>${escapeHtml(label)}</span>`
        : `<i data-lucide="upload-cloud"></i><span>${escapeHtml(label)}</span>`;
      refreshIcons();
    }

    /* ---------------- 13. CLOUD + LOCAL CACHE PERSISTENCE ---------------- */
    function loadLocalRecords() {
      try {
        const saved = JSON.parse(localStorage.getItem("communicationRecords") || "[]");
        records = Array.isArray(saved) ? saved : [];
      } catch {
        records = [];
      }
    }

    function saveLocalRecords() {
      try {
        localStorage.setItem("communicationRecords", JSON.stringify(records));
      } catch (e) {
        console.warn("Storage warning:", e);
      }
    }

    function cloudRowToRecord(row) {
      return {
        id: String(row.id),
        ...(row.data || {}),
        createdAt: row.data?.createdAt || row.created_at || null,
        updatedAt: row.data?.updatedAt || row.updated_at || null
      };
    }

    async function loadRecords() {
      loadLocalRecords();
      const cachedRecords = [...records];

      if (supabaseConfigured) {
        try {
          const { data, error } = await supabaseClient
            .from(COMMUNICATIONS_TABLE)
            .select("id,data,created_at,updated_at")
            .order("created_at", { ascending: false });
          if (error) throw error;

          const cloudRecords = (data || []).map(cloudRowToRecord);
          const merged = new Map(cloudRecords.map(record => [String(record.id), record]));
          const cachedOnly = [];

          cachedRecords.forEach(record => {
            const key = String(record.id || record.controlNo || "");
            if (!key) return;
            if (!merged.has(key)) {
              const normalized = { ...record, id: key };
              merged.set(key, normalized);
              cachedOnly.push(normalized);
            }
          });

          records = Array.from(merged.values()).sort((a, b) => {
            const aDate = new Date(a.updatedAt || a.createdAt || a.date || 0).getTime() || 0;
            const bDate = new Date(b.updatedAt || b.createdAt || b.date || 0).getTime() || 0;
            return bDate - aDate;
          });

          cloudRecordsAvailable = true;
          saveLocalRecords();
          renderRecords();

          if (cachedOnly.length) {
            const migrations = await Promise.allSettled(cachedOnly.map(record => saveRecordToCloud(record)));
            const failed = migrations.filter(result => result.status === "rejected").length;
            if (failed) {
              console.warn(`${failed} cached communication record(s) could not be migrated to Supabase.`);
            }
          }
          return;
        } catch (error) {
          cloudRecordsAvailable = false;
          console.warn("Communications cloud sync fallback:", error);
        }
      }

      renderRecords();
    }

    async function saveRecordToCloud(record) {
      if (!supabaseConfigured) return false;
      const payload = { ...record, updatedAt: new Date().toISOString() };
      delete payload.id;
      const { error } = await supabaseClient
        .from(COMMUNICATIONS_TABLE)
        .upsert({
          id: String(record.id),
          data: payload,
          updated_at: new Date().toISOString()
        }, { onConflict: "id" });
      if (error) throw error;
      cloudRecordsAvailable = true;
      return true;
    }

    async function deleteRecordFromCloud(id) {
      if (!supabaseConfigured || !id) return false;
      const { error } = await supabaseClient
        .from(COMMUNICATIONS_TABLE)
        .delete()
        .eq("id", String(id));
      if (error) throw error;
      cloudRecordsAvailable = true;
      return true;
    }

    // Incoming/Outgoing changes must never replace the printed control number.

    /* ---------------- 14. MODAL ACTIONS & DISPATCHER ---------------- */
    function openEncodingModal() {
      encodingModal?.classList.add("open");
      encodingModal?.setAttribute("aria-hidden", "false");
      document.body.classList.add("admin-modal-open");
      refreshIcons();
    }

    function closeEncodingModal() {
      encodingModal?.classList.remove("open");
      encodingModal?.setAttribute("aria-hidden", "true");
      document.body.classList.remove("admin-modal-open");
      resetForm();
    }

    function resetForm() {
      ocrRunToken += 1;
      ocrBusy = false;
      lastDetectedFields = null;
      communicationForm?.reset();
      if (editIndexInput) editIndexInput.value = "";
      if (modalTitle) modalTitle.textContent = "Encoding Communication Record";
      if (controlNoInput) controlNoInput.value = "";
      if (dateInput) dateInput.value = "";
      Object.keys(lastOcrValues).forEach(key => delete lastOcrValues[key]);
      if (documentFileInput) documentFileInput.value = "";
      if (ocrTextInput) ocrTextInput.value = "";
      if (ocrStatsChip) ocrStatsChip.style.display = "none";

      selectedFile = null;
      existingEditFileName = "";
      existingEditDriveLink = "";
      clearPreviewBlob();
      updateFileUI();
      resetProgress();
      setSaveButton(false, "Encode & Save Record");
    }

    openEncodingModalBtn?.addEventListener("click", () => {
      resetForm();
      openEncodingModal();
    });

    closeEncodingModalBtn?.addEventListener("click", closeEncodingModal);
    cancelEncodingBtn?.addEventListener("click", closeEncodingModal);

    encodingModal?.addEventListener("click", (event) => {
      if (event.target === encodingModal) closeEncodingModal();
    });
    viewOcrModal?.addEventListener("click", (event) => {
      if (event.target === viewOcrModal) {
        viewOcrModal.classList.remove("open");
        viewOcrModal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("admin-modal-open");
      }
    });
    viewDocumentModal?.addEventListener("click", (event) => {
      if (event.target === viewDocumentModal) {
        viewDocumentModal.classList.remove("open");
        viewDocumentModal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("admin-modal-open");
        if (docViewerIframe) docViewerIframe.src = "";
        if (docViewerImage) docViewerImage.src = "";
      }
    });

    async function editRecord(index) {
      const record = records[index];
      if (!record) return;

      resetForm();
      editIndexInput.value = String(index);
      typeSelect.value = record.type || "";
      controlNoInput.value = record.controlNo || "";
      docTypeSelect.value = record.documentType || "";
      dateInput.value = record.date || "";
      statusSelect.value = record.status || "";
      officeInput.value = record.office || "";
      subjectInput.value = record.subject || "";
      actionTakenInput.value = record.actionTaken || record.dateForwarded || "";
      remarksInput.value = record.remarks || "";
      ocrTextInput.value = record.ocrText || "";

      existingEditFileName = record.fileName || "";
      existingEditDriveLink = record.driveLink || "";

      const stored = await getStoredFile(record.id || record.controlNo);
      if (stored && stored.blob) {
        try {
          selectedFile = new File(
            [stored.blob],
            stored.name || record.fileName || "document",
            { type: stored.type || stored.blob.type || "application/octet-stream" }
          );
        } catch {
          selectedFile = stored.blob;
          try {
            Object.defineProperty(selectedFile, "name", { value: stored.name || record.fileName || "document" });
          } catch {}
        }
      }

      updateFileUI(selectedFile, existingEditFileName);
      if (modalTitle) modalTitle.textContent = "Edit Communication Record";
      setSaveButton(false, "Update Record");
      openEncodingModal();
    }

    function viewOCR(index) {
      const record = records[index];
      if (!record || !viewOcrModal) return;
      if (viewOcrFileName) viewOcrFileName.textContent = record.fileName ? `File: ${record.fileName}` : "No file";
      if (viewOcrContent) viewOcrContent.value = record.ocrText || "No OCR text extracted.";
      viewOcrModal.classList.add("open");
      viewOcrModal.setAttribute("aria-hidden", "false");
      document.body.classList.add("admin-modal-open");
    }

    closeViewOcrModalBtn?.addEventListener("click", () => {
      viewOcrModal?.classList.remove("open");
      viewOcrModal?.setAttribute("aria-hidden", "true");
      document.body.classList.remove("admin-modal-open");
    });

    async function deleteRecord(index) {
      const record = records[index];
      if (!record) return;
      if (!confirm(`Delete record ${record.controlNo || ""}?`)) return;

      try {
        if (supabaseConfigured && record.id) {
          await deleteRecordFromCloud(record.id);
        }
      } catch (error) {
        console.error("Cloud delete failed:", error);
        showToast("Could not delete the cloud record. Nothing was removed.", "error");
        return;
      }

      if (record.id) await deleteStoredFile(record.id);
      if (record.controlNo) await deleteStoredFile(record.controlNo);

      records.splice(index, 1);
      saveLocalRecords();
      renderRecords();
      showToast("Record and local soft copy deleted.", "success");
    }

    communicationTableBody?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const index = Number(btn.dataset.index);
      if (Number.isNaN(index)) return;

      const action = btn.dataset.action;
      if (action === "edit") editRecord(index);
      if (action === "ocr") viewOCR(index);
      if (action === "delete") deleteRecord(index);
      if (action === "view-doc") viewDocument(index);
      if (action === "download-doc") downloadRecordFile(index);
    });

    communicationTableBody?.addEventListener("change", (e) => {
      const checkbox = e.target.closest(".row-checkbox");
      if (!checkbox) return;
      const key = String(checkbox.dataset.recordKey || "");
      if (!key) return;
      if (checkbox.checked) selectedRecordIds.add(key);
      else selectedRecordIds.delete(key);
      checkbox.closest("tr")?.classList.toggle("is-selected", checkbox.checked);
      updateSelectionUI();
    });

    selectAllRows?.addEventListener("change", () => {
      const filtered = getFilteredRecords();
      filtered.forEach(record => {
        const key = getRecordKey(record, records.indexOf(record));
        if (selectAllRows.checked) selectedRecordIds.add(key);
        else selectedRecordIds.delete(key);
      });
      renderRecords();
    });

    clearSelectionBtn?.addEventListener("click", clearSelection);
    bulkArchiveBtn?.addEventListener("click", archiveSelectedRecords);
    bulkDeleteBtn?.addEventListener("click", deleteSelectedRecords);
    exportCommunicationsBtn?.addEventListener("click", exportFilteredRecords);
    syncCommunicationsBtn?.addEventListener("click", syncCommunications);

    notificationList?.addEventListener("click", (event) => {
      const item = event.target.closest("[data-notification-index]");
      if (!item) return;
      const index = Number(item.dataset.notificationIndex);
      if (!Number.isFinite(index)) return;
      notificationDropdown?.classList.remove("open");
      if (notificationDropdown) notificationDropdown.style.display = "none";
        notificationsBtn?.setAttribute("aria-expanded", "false");
      editRecord(index);
    });

    /* ---------------- 15. FILTERS & SEARCH ---------------- */
    filterTabs.forEach(tab => {
      tab.addEventListener("click", () => {
        filterTabs.forEach(t => { t.classList.remove("active"); t.setAttribute("aria-pressed", "false"); });
        tab.classList.add("active");
        tab.setAttribute("aria-pressed", "true");
        currentTypeFilter = tab.dataset.type || "All";
        renderRecords();
      });
    });

    statusFilter?.addEventListener("change", (e) => {
      currentStatusFilter = e.target.value || "All";
      renderRecords();
    });

    tableSearchInput?.addEventListener("input", () => {
      if (globalSearchInput) globalSearchInput.value = tableSearchInput.value;
      renderRecords();
    });
    globalSearchInput?.addEventListener("input", () => {
      if (tableSearchInput) tableSearchInput.value = globalSearchInput.value;
      renderRecords();
    });

    function showToast(message, type = "success") {
      let stack = $(".admin-ui-toast-stack");
      if (!stack) {
        stack = document.createElement("div");
        stack.className = "admin-ui-toast-stack";
        document.body.appendChild(stack);
      }
      const toast = document.createElement("div");
      toast.className = "admin-ui-toast";
      toast.dataset.type = type;
      toast.setAttribute("role", type === "error" ? "alert" : "status");
      const icon = type === "error" ? "alert-circle" : (type === "warning" ? "alert-triangle" : "circle-check");
      toast.innerHTML = `<i data-lucide="${icon}"></i><span>${escapeHtml(message)}</span>`;
      stack.appendChild(toast);
      refreshIcons();
      setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 250);
      }, 3500);
    }

    /* ---------------- 16. INITIALIZATION ---------------- */
    resetForm();
    await loadRecords();
    refreshIcons();

    if (supabaseConfigured) {
      try {
        supabaseClient
          .channel("admin:communications")
          .on("postgres_changes", { event: "*", schema: "public", table: COMMUNICATIONS_TABLE }, () => loadRecords())
          .subscribe();
      } catch (error) {
        console.warn("Communications realtime notice:", error);
      }
    }

    const serverOk = await checkOcrServer();
    if (dbStatusDot) {
      dbStatusDot.classList.toggle("online", cloudRecordsAvailable);
      dbStatusDot.classList.toggle("offline", !cloudRecordsAvailable);
    }
    if (dbStatusText) {
      const databaseState = cloudRecordsAvailable ? "Online Mode" : "Local Cache";
      const ocrState = serverOk ? "OCR Online" : "OCR Offline";
      dbStatusText.textContent = `${databaseState} · ${ocrState}`;
    }
  }
})();
/* Module-owned motion; content remains visible if JavaScript is unavailable. */
/* Progressive, one-time entrance effects for the administrator workspace. */
(() => {
  'use strict';
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const targets = [
    '.main-content > .page-header',
    '.main-content > .ics-admin-header',
    '.main-content :is(.kpi-grid,.stats-grid,.metrics-grid,.ics-kpi-grid) > *',
    '.main-content .module-control-grid > *',
    '.main-content :is(.section-header,.panel-header,.ics-panel-header)',
    '.main-content :is(.chart-card,.table-card,.ics-panel,.service-form-card)'
  ].join(',');

  function init() {
    if (motionQuery?.matches || !('IntersectionObserver' in window)) return;
    const seen = new WeakSet();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: .04, rootMargin: '0px 0px -18px 0px' });

    const register = root => {
      const elements = root.matches?.(targets) ? [root] : [...root.querySelectorAll(targets)];
      for (const element of elements) {
        if (seen.has(element) || element.closest('[hidden],.modal-backdrop,.modal-overlay')) continue;
        seen.add(element);
        const siblings = [...element.parentElement.children].filter(el => el.matches(targets));
        element.style.setProperty('--admin-stagger', `${Math.min(siblings.indexOf(element), 5) * 45}ms`);
        element.classList.add('admin-motion-pending');
        observer.observe(element);
      }
    };

    register(document.querySelector('.main-content') || document.body);
    const main = document.querySelector('.main-content');
    if (main) {
      const changes = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === 1) register(node);
        }
      });
      changes.observe(main, { childList: true, subtree: true });
      window.addEventListener('pagehide', () => { changes.disconnect(); observer.disconnect(); }, { once: true });
    }
    motionQuery?.addEventListener?.('change', event => {
      if (!event.matches) return;
      observer.disconnect();
      document.querySelectorAll('.admin-motion-pending').forEach(el => el.classList.add('is-visible'));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

/* Keyboard focus follows the visible dialog or mobile navigation drawer. */
(() => {
  function installFocusManagement() {
    const sidebar = document.getElementById('sidebar');
    const app = document.querySelector('.app-layout');
    const main = document.querySelector('.main-wrapper');
    const mobile = window.matchMedia('(max-width: 900px)');
    const modals = [...document.querySelectorAll('.modal-overlay, .admin-modal-backdrop')];
    let activeLayer = null;
    let returnTo = null;
    const focusable = root => [...root.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
      .filter(el => !el.disabled && el.tabIndex >= 0 && !el.closest('[hidden], [inert]') && el.getClientRects().length);
    function sync() {
      const dialog = modals.find(el => el.classList.contains('open'));
      const navOpen = mobile.matches && sidebar?.classList.contains('mobile-open');
      const next = dialog || (navOpen ? sidebar : null);
      if (app) app.inert = Boolean(dialog);
      if (main) main.inert = Boolean(navOpen && !dialog);
      if (sidebar) sidebar.inert = Boolean(mobile.matches && !navOpen);
      const closeNav = document.getElementById('sidebarCollapseBtn');
      if (closeNav && mobile.matches) closeNav.setAttribute('aria-label', 'Close navigation');
      if (next === activeLayer) return;
      if (next) {
        if (!activeLayer) returnTo = document.activeElement;
        activeLayer = next;
        const first = next.querySelector('input:not([type=hidden]), select, textarea') || focusable(next)[0];
        first?.focus({preventScroll:true});
      } else {
        activeLayer = null;
        if (returnTo?.isConnected && !returnTo.closest('[inert]')) returnTo.focus({preventScroll:true});
        returnTo = null;
      }
    }
    const observer = new MutationObserver(sync);
    for (const el of [...modals, sidebar].filter(Boolean)) observer.observe(el, {attributes:true,attributeFilter:['class']});
    mobile.addEventListener('change', sync);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Tab' || !activeLayer) return;
      const items = focusable(activeLayer);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !activeLayer.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !activeLayer.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installFocusManagement, {once:true});
  else installFocusManagement();
})();
