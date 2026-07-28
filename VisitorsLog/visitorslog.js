document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("visitorForm");
  const inputs = document.querySelectorAll("#visitorForm input, #visitorForm textarea, #visitorForm select");
  const progressBar = document.getElementById("progressBar");
  const modal = document.getElementById("successModal");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const formContainer = document.querySelector(".form-container");

  const purposeCategory = document.getElementById("purposeCategory");
  const otherPurposeGroup = document.getElementById("otherPurposeGroup");
  const otherPurposeSpecific = document.getElementById("otherPurposeSpecific");

  let activeSkyClass = "day"; // Tracks the sky color palette to sync leaves

  // Setup Dynamic Category Toggle
  if (purposeCategory && otherPurposeGroup && otherPurposeSpecific) {
    purposeCategory.addEventListener("change", () => {
      const isOther = purposeCategory.value.toLowerCase().includes("other");
      if (isOther) {
        otherPurposeGroup.classList.remove("hidden");
        otherPurposeSpecific.setAttribute("required", "true");
        // Force Reflow for elegant transition entry
        void otherPurposeGroup.offsetHeight;
        otherPurposeGroup.classList.add("visible");
      } else {
        otherPurposeGroup.classList.remove("visible");
        otherPurposeSpecific.removeAttribute("required");
        otherPurposeSpecific.value = "";
        otherPurposeGroup.classList.remove("error", "success");
        // Hide after exit animation finishes
        setTimeout(() => {
          if (!purposeCategory.value.toLowerCase().includes("other")) {
            otherPurposeGroup.classList.add("hidden");
          }
        }, 250);
      }
      updateProgress();
    });
  }

  // Optimized Leaf Generator (Dynamic Theme-Based Leaves)
  function createLeaves() {
    const container = document.getElementById("leaves-container");
    if (!container) return;

    container.innerHTML = "";
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < 35; i++) {
      const leaf = document.createElement("div");
      leaf.className = `leaf leaf-type-${(i % 3) + 1}`;

      // Configured negative delay to make leaves instantly visible upon page load
      const fallDuration = Math.random() * 8 + 8;
      const swayDuration = Math.random() * 4 + 4;
      const negativeDelay = Math.random() * -20; 
      const scale = Math.random() * 0.5 + 0.5;
      const opacity = Math.random() * 0.4 + 0.3;

      leaf.style.left = `${Math.random() * 100}vw`;
      leaf.style.animationDuration = `${fallDuration}s, ${swayDuration}s`;
      leaf.style.animationDelay = `${negativeDelay}s, ${negativeDelay}s`;
      leaf.style.transform = `scale(${scale})`;
      leaf.style.opacity = opacity;

      // Assign custom theme class matching the active sky state
      leaf.setAttribute("data-sky-theme", activeSkyClass);

      fragment.appendChild(leaf);
    }

    container.appendChild(fragment);
  }

  // Updates existing leaves colors when the sky background shifts
  function updateLeavesTheme(newSkyClass) {
    activeSkyClass = newSkyClass;
    const leaves = document.querySelectorAll(".leaf");
    leaves.forEach(leaf => {
      leaf.setAttribute("data-sky-theme", newSkyClass);
    });
  }

  // Live Dynamic Clock Engine
  function initClock() {
    const todayDateEl = document.getElementById("todayDate");
    const timeHour = document.getElementById("timeHour");
    const timeMinute = document.getElementById("timeMinute");
    const timeSecond = document.getElementById("timeSecond");
    const timeAmpm = document.getElementById("timeAmpm");

    const secHand = document.getElementById("secHand");
    const minHand = document.getElementById("minHand");
    const hourHand = document.getElementById("hourHand");

    const sky = document.getElementById("sky-background");
    const celestial = document.getElementById("celestialBody");

    function updateClockAndSky() {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const seconds = now.getSeconds();

      const displayHours = hours % 12 || 12;
      const ampm = hours >= 12 ? "PM" : "AM";

      if (todayDateEl) {
        todayDateEl.textContent = now.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric"
        }).toUpperCase();
      }

      if (timeHour) timeHour.textContent = String(displayHours).padStart(2, "0");
      if (timeMinute) timeMinute.textContent = String(minutes).padStart(2, "0");
      if (timeSecond) timeSecond.textContent = String(seconds).padStart(2, "0");
      if (timeAmpm) timeAmpm.textContent = ampm;

      // Clock rotation calculations
      const secondDeg = seconds * 6;
      const minuteDeg = minutes * 6 + seconds * 0.1;
      const hourDeg = (hours % 12) * 30 + minutes * 0.5;

      if (secHand) secHand.style.transform = `rotate(${secondDeg}deg)`;
      if (minHand) minHand.style.transform = `rotate(${minuteDeg}deg)`;
      if (hourHand) hourHand.style.transform = `rotate(${hourDeg}deg)`;

      const timeDecimal = hours + minutes / 60 + seconds / 3600;

      // Sky Background State Selector
      if (sky) {
        let currentClass = "night";
        if (timeDecimal >= 5 && timeDecimal < 9) {
          currentClass = "morning";
        } else if (timeDecimal >= 9 && timeDecimal < 16) {
          currentClass = "day";
        } else if (timeDecimal >= 16 && timeDecimal < 18.5) {
          currentClass = "sunset";
        }

        if (!sky.classList.contains(currentClass)) {
          sky.classList.remove("morning", "day", "sunset", "night");
          sky.classList.add(currentClass);
          updateLeavesTheme(currentClass);
        }
      }

      // Parabolic Arc celestial translation (Sun & Moon placement)
      if (celestial) {
        let progress;
        if (timeDecimal >= 6 && timeDecimal <= 18) {
          progress = (timeDecimal - 6) / 12;
        } else {
          const nightTime = timeDecimal > 18 ? timeDecimal - 18 : timeDecimal + 6;
          progress = nightTime / 12;
        }

        const x = 8 + progress * 84;
        const y = 78 - Math.sin(progress * Math.PI) * 64;

        celestial.style.left = `${x}%`;
        celestial.style.top = `${y}%`;
      }
    }

    updateClockAndSky();
    setInterval(updateClockAndSky, 1000);
  }

  // Elegant field validator with localized dynamic messaging
  function validateField(input) {
    const group = input.closest(".input-group");
    if (!group || group.classList.contains("hidden")) return true;

    const errorDisplay = group.querySelector(".error-msg");
    const value = input.value.trim();
    
    group.classList.remove("error", "success");

    // Retrieve label text dynamically to build dynamic validation messages
    const labelElement = group.querySelector("label");
    const fieldName = labelElement ? labelElement.textContent.replace("'", "") : "Field";

    if (!value) {
      group.classList.add("error");
      if (errorDisplay) {
        if (input.id === "purposeCategory") {
          errorDisplay.textContent = "Please select a purpose category.";
        } else {
          errorDisplay.textContent = `${fieldName} is required.`;
        }
      }
      return false;
    }

    if (input.id === "contact") {
      const phoneRegex = /^09\d{9}$/;
      if (!phoneRegex.test(value)) {
        group.classList.add("error");
        if (errorDisplay) {
          errorDisplay.textContent = "Use 11 digits starting with 09.";
        }
        return false;
      }
    }

    group.classList.add("success");
    if (errorDisplay) errorDisplay.textContent = "";
    return true;
  }

  // Form Submission Progress Meter Engine
  function updateProgress() {
    if (!progressBar || inputs.length === 0) return;

    const activeInputs = Array.from(inputs).filter(input => {
      const group = input.closest(".input-group");
      return group && !group.classList.contains("hidden");
    });

    let validCount = 0;

    activeInputs.forEach(input => {
      const value = input.value.trim();
      if (input.id === "contact") {
        if (/^09\d{9}$/.test(value)) validCount++;
      } else if (value !== "") {
        validCount++;
      }
    });

    const percentage = activeInputs.length > 0 ? (validCount / activeInputs.length) * 100 : 0;
    progressBar.style.width = `${percentage}%`;
  }

  // Optimized Event Listeners Binding
  inputs.forEach(input => {
    input.addEventListener("input", () => {
      if (input.id === "contact") {
        input.value = input.value.replace(/\D/g, "").slice(0, 11);
      }

      const group = input.closest(".input-group");
      if (group && group.classList.contains("error")) {
        validateField(input);
      }
      updateProgress();
    });

    input.addEventListener("change", () => {
      validateField(input);
      updateProgress();
    });

    input.addEventListener("blur", () => {
      validateField(input);
    });
  });

  // Handle Form Submissions
  if (form) {
    form.addEventListener("submit", e => {
      e.preventDefault();

      let isValid = true;
      inputs.forEach(input => {
        if (!validateField(input)) isValid = false;
      });

      if (!isValid) {
        if (formContainer) {
          formContainer.classList.remove("shake-effect");
          void formContainer.offsetWidth; // Reflow trigger
          formContainer.classList.add("shake-effect");
        }
        return;
      }

      const visitorData = {
        fullName: document.getElementById("fullName")?.value.trim() || "",
        contact: document.getElementById("contact")?.value.trim() || "",
        address: document.getElementById("address")?.value.trim() || "",
        personToVisit: document.getElementById("personToVisit")?.value.trim() || "",
        purposeCategory: document.getElementById("purposeCategory")?.value || "",
        otherPurposeSpecific: document.getElementById("otherPurposeSpecific")?.value.trim() || "",
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
        timestamp: new Date().toISOString()
      };

      try {
        if (window.firebaseDB) {
          window.firebaseDB.ref('visitors').push(visitorData).catch(err => {
            console.error('Firebase save failed, running localStorage fallback:', err);
            saveToLocal(visitorData);
          });
        } else {
          saveToLocal(visitorData);
        }
      } catch (error) {
        console.error("Local entry save execution failed:", error);
      }

      const visitorNameDisplay = document.getElementById("visitorNameDisplay");
      if (visitorNameDisplay) {
        visitorNameDisplay.textContent = visitorData.fullName.split(" ")[0] || "Visitor";
      }

      if (modal) {
        modal.classList.add("show");
        modal.setAttribute("aria-hidden", "false");
      }

      // Safe State reset
      form.reset();
      
      if (otherPurposeGroup) {
         otherPurposeGroup.classList.remove("visible");
         otherPurposeGroup.classList.add("hidden");
      }

      inputs.forEach(input => {
        const group = input.closest(".input-group");
        if (group) group.classList.remove("success", "error");
      });

      updateProgress();
    });
  }

  function saveToLocal(data) {
    const visitorsLog = JSON.parse(localStorage.getItem("pgenro_visitors")) || [];
    visitorsLog.push(data);
    localStorage.setItem("pgenro_visitors", JSON.stringify(visitorsLog));
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.add("modal-leaving");
    setTimeout(() => {
      modal.classList.remove("show", "modal-leaving");
      modal.setAttribute("aria-hidden", "true");
    }, 300); // Wait for modal fade out transition
  }

  if (closeModalBtn) closeModalBtn.addEventListener("click", closeModal);
  if (modal) {
    modal.addEventListener("click", e => {
      if (e.target === modal) closeModal();
    });
  }

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModal();
  });

  // Initial Boot sequence
  initClock();
  createLeaves();
  updateProgress(); // Compute dynamic progress immediately for any prefilled values
});