"use strict";
/* Lantern landing — mobile menu toggle, smooth in-page scrolling, lead form. */

const menuBtn = document.querySelector(".menu-btn");
const links = document.querySelector("#links");

menuBtn.addEventListener("click", () => {
  const open = links.classList.toggle("open");
  menuBtn.setAttribute("aria-expanded", String(open));
});

// close the mobile menu after picking a link
links.addEventListener("click", (e) => {
  if (e.target.closest("a")) {
    links.classList.remove("open");
    menuBtn.setAttribute("aria-expanded", "false");
  }
});

// smooth scroll for in-page anchors (CSS scroll-behavior already on, belt-and-braces)
for (const a of document.querySelectorAll('a[href^="#"]')) {
  a.addEventListener("click", (e) => {
    const id = a.getAttribute("href").slice(1);
    const target = document.getElementById(id);
    if (id && target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

// lead capture — no backend, honest success message
const form = document.querySelector("#lead-form");
const thanks = document.querySelector("#thanks");
form.addEventListener("submit", (e) => {
  e.preventDefault();
  form.hidden = true;
  thanks.hidden = false;
});