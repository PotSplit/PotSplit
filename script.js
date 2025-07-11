// Placeholder: Add advanced interactivity here if needed later
console.log("PotSplit JS loaded.");

// Example countdown timer for future use
function startCountdown(targetDate, elementId) {
  const countDownDate = new Date(targetDate).getTime();
  const countdownFunction = setInterval(function () {
    const now = new Date().getTime();
    const distance = countDownDate - now;

    if (distance < 0) {
      clearInterval(countdownFunction);
      document.getElementById(elementId).innerText = "Draw closed!";
      return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor(
      (distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
    );
    const minutes = Math.floor(
      (distance % (1000 * 60 * 60)) / (1000 * 60)
    );
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    document.getElementById(elementId).innerText =
      `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }, 1000);
}
