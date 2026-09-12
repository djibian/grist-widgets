import { icon } from "../icons.js";

for (const target of document.querySelectorAll("[data-icon]")) {
  target.innerHTML = icon(target.dataset.icon, { size: 17 });
}
