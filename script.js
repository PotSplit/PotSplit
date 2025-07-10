// Countdown Timer Example
function startCountdown(targetId, targetDateStr) {
  const targetDate = new Date(targetDateStr).getTime();
  const el = document.getElementById(targetId);

  if (!el) return;

  const interval = setInterval(() => {
    const now = new Date().getTime();
    const distance = targetDate - now;

    if (distance <= 0) {
      clearInterval(interval);
      el.innerHTML = "⏳ Drawing Soon!";
      return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    el.innerHTML = `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }, 1000);
}

// Example usage
document.addEventListener("DOMContentLoaded", () => {
  startCountdown("weekly-timer", "2025-07-12T20:00:00");
  startCountdown("monthly-timer", "2025-07-31T20:00:00");
});
