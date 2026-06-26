/**
 * Blackstar Support Tool - Falling Snowflakes Background
 *
 * Renders white circular snowflakes of varying sizes that drift
 * downward on a transparent canvas behind the UI.
 */

(function initSnowflakes() {
  const canvas = document.createElement('canvas');
  canvas.id = 'snowflake-canvas';
  document.body.prepend(canvas);

  const ctx = canvas.getContext('2d');
  let width, height;
  const flakes = [];
  const FLAKE_COUNT = 80;

  function resize() {
    width  = canvas.width  = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  function createFlake() {
    return {
      x: Math.random() * width,
      y: Math.random() * -height,           // start above viewport
      r: Math.random() * 3 + 1,             // radius 1–4 px
      speed: Math.random() * 0.8 + 0.3,     // fall speed
      drift: (Math.random() - 0.5) * 0.4,   // slight horizontal sway
      opacity: Math.random() * 0.5 + 0.3,   // 0.3–0.8 alpha
    };
  }

  function init() {
    resize();
    flakes.length = 0;
    for (let i = 0; i < FLAKE_COUNT; i++) {
      const f = createFlake();
      f.y = Math.random() * height;          // spread throughout viewport
      flakes.push(f);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    for (const f of flakes) {
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${f.opacity})`;
      ctx.fill();

      // Update position
      f.y += f.speed;
      f.x += f.drift;

      // Recycle when it leaves the bottom or sides
      if (f.y > height + f.r || f.x < -10 || f.x > width + 10) {
        f.y = -f.r * 2;
        f.x = Math.random() * width;
        f.r = Math.random() * 3 + 1;
        f.speed = Math.random() * 0.8 + 0.3;
        f.drift = (Math.random() - 0.5) * 0.4;
        f.opacity = Math.random() * 0.5 + 0.3;
      }
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('DOMContentLoaded', () => {
    init();
    draw();
  });

  // If DOM is already loaded (script loaded late)
  if (document.readyState !== 'loading') {
    init();
    draw();
  }
})();
