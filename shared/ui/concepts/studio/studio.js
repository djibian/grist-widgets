const tabs = [...document.querySelectorAll('.demo-tab')];
const panels = [...document.querySelectorAll('.widget-demo')];

function selectDemo(name) {
  tabs.forEach((tab) => {
    const active = tab.dataset.demo === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });

  panels.forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.panel === name);
  });
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => selectDemo(tab.dataset.demo));
});

selectDemo('structures');
