// script.js
function startCountdown(id, endDate) {
  const display = document.getElementById(id);
  const end = new Date(endDate).getTime();

  function update() {
    const now = new Date().getTime();
    const distance = end - now;

    if (distance < 0) {
      display.innerHTML = "⏰ Draw in progress or ended.";
      return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((distance % (1000 * 60)) / 1000);

    display.innerHTML = `⏳ ${days}d ${hours}h ${mins}m ${secs}s`;
    setTimeout(update, 1000);
  }

  update();
}
