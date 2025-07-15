// Optional: subtle glitch effect
document.querySelectorAll('.vfx-page p').forEach(p => {
  p.addEventListener('mouseenter', () => {
    p.style.animation = 'flicker 0.3s infinite alternate';
  });
  p.addEventListener('mouseleave', () => {
    p.style.animation = 'flicker 4s infinite alternate';
  });
});
