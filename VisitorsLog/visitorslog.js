const form = document.getElementById("visitorForm");
const inputs = document.querySelectorAll("input, textarea");
const progressBar = document.getElementById("progressBar");
const modal = document.getElementById("successModal");

const todayDate = document.getElementById("todayDate");
const liveTime = document.getElementById("liveTime");

function updateClock() {
  const now = new Date();

  todayDate.textContent = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  liveTime.textContent = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

setInterval(updateClock, 1000);
updateClock();

inputs.forEach(input => {
  input.addEventListener("input", () => {
    validateInput(input);
    updateProgress();
  });
});

function validateInput(input) {
  const parent = input.parentElement;
  const small = parent.querySelector("small");

  if (input.value.trim() === "") {
    parent.className = "input-group error";
    small.textContent = "This field is required.";
    return false;
  }

  if (input.id === "contact" && input.value.trim().length < 11) {
    parent.className = "input-group error";
    small.textContent = "Please enter a valid contact number.";
    return false;
  }

  parent.className = "input-group success";
  small.textContent = "";
  return true;
}

function updateProgress() {
  let filled = 0;

  inputs.forEach(input => {
    if (input.value.trim() !== "") {
      filled++;
    }
  });

  const percentage = (filled / inputs.length) * 100;
  progressBar.style.width = percentage + "%";
}

form.addEventListener("submit", function(e) {
  e.preventDefault();

  let isValid = true;

  inputs.forEach(input => {
    if (!validateInput(input)) {
      isValid = false;
    }
  });

  if (!isValid) return;

  const visitorData = {
    fullName: document.getElementById("fullName").value.trim(),
    contact: document.getElementById("contact").value.trim(),
    address: document.getElementById("address").value.trim(),
    personToVisit: document.getElementById("personToVisit").value.trim(),
    purpose: document.getElementById("purpose").value.trim(),
    dateTime: new Date().toLocaleString()
  };

  let visitors = JSON.parse(localStorage.getItem("visitorsLog")) || [];
  visitors.push(visitorData);

  localStorage.setItem("visitorsLog", JSON.stringify(visitors));

  form.reset();
  inputs.forEach(input => {
    input.parentElement.className = "input-group";
    input.parentElement.querySelector("small").textContent = "";
  });

  updateProgress();
  modal.classList.add("show");
});

function closeModal() {
  modal.classList.remove("show");
}