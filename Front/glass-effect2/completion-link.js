"use strict";

function addMixerLinks() {
  for (const downloadLink of document.querySelectorAll(
    '.youtube-job a[href*="/api/jobs/"][href$="/download"]',
  )) {
    const match = downloadLink
      .getAttribute("href")
      ?.match(/\/api\/jobs\/([0-9a-f-]{36})\/download/i);
    if (!match || downloadLink.parentElement.querySelector("[data-open-mixer]")) {
      continue;
    }

    const mixerLink = document.createElement("a");
    mixerLink.className = "button button--secondary";
    mixerLink.dataset.openMixer = "";
    mixerLink.href = `musics.html#library/${match[1]}`;
    mixerLink.innerHTML = `
      <span class="iconify" data-icon="lucide:sliders-horizontal"></span>
      Abrir no mixer
    `;
    downloadLink.after(mixerLink);
    window.Iconify?.scan?.(mixerLink);
  }
}

const observer = new MutationObserver(addMixerLinks);
observer.observe(document.body, { childList: true, subtree: true });
addMixerLinks();

