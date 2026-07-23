const hamburgerMenu = document.getElementById("hamburgerMenu");
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
const mainContent = document.querySelector(".main-content");
const toggleFormBtn = document.getElementById("toggleFormBtn");
const formSection = document.getElementById("formSection");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const cancelBtn = document.getElementById("cancelBtn");
const travelOrderForm = document.getElementById("travelOrderForm");

if (window.lucide) {
  lucide.createIcons();
}

function openDrawer() {
  formSection.classList.add("open");
  drawerBackdrop.classList.add("active");
}

function closeDrawer() {
  formSection.classList.remove("open");
  drawerBackdrop.classList.remove("active");
}

hamburgerMenu.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  hamburgerMenu.classList.toggle("active");
  overlay.classList.toggle("active");
  mainContent.classList.toggle("blur");
});

overlay.addEventListener("click", () => {
  sidebar.classList.remove("open");
  hamburgerMenu.classList.remove("active");
  overlay.classList.remove("active");
  mainContent.classList.remove("blur");
});

drawerBackdrop.addEventListener("click", closeDrawer);
cancelBtn.addEventListener("click", closeDrawer);
toggleFormBtn.addEventListener("click", openDrawer);

travelOrderForm.addEventListener("submit", (event) => {
  event.preventDefault();
  alert("Travel order saved. This is the UI template for the PGENRO theme.");
  closeDrawer();
});
