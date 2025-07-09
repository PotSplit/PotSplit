function countdown(elementId, targetDate) {
  const el = document.getElementById(elementId);
  const update = () => {
    const now = new Date().getTime();
    const distance = targetDate - now;
    if (distance < 0) {
      el.innerHTML = "Draw ended!";
      return;
    }
    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((distance / (1000 * 60)) % 60);
    const seconds = Math.floor((distance / 1000) % 60);
    el.innerHTML = days + "d " + hours + "h " + minutes + "m " + seconds + "s ";
  };
  update();
  setInterval(update, 1000);
}
countdown("weekly-timer", new Date("2025-07-15T20:00:00").getTime());
countdown("monthly-timer", new Date("2025-07-31T20:00:00").getTime());
