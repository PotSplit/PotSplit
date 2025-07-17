
document.addEventListener("DOMContentLoaded", () => {
  const editorToggle = document.getElementById("editorToggle");
  const statsToggle = document.getElementById("statsToggle");
  const wakeToggle = document.getElementById("wakeToggle");
  const statsPanel = document.getElementById("statsPanel");

  statsToggle.addEventListener("change", () => {
    statsPanel.classList.toggle("hidden", !statsToggle.checked);
  });

  let wakeTimeout;
  wakeToggle.addEventListener("change", () => {
    if (wakeToggle.checked) {
      wakeTimeout = setTimeout(() => {
        alert("⚠️ Wake up! You’ve been idle too long.");
      }, 60000);
    } else {
      clearTimeout(wakeTimeout);
    }
  });
});
