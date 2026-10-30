/**
 * @file GameArt.jsx
 * @description Vector art preview cards for the 4 Battle Arena game types.
 */

export function BrainArt() {
  return (
    <svg className="brain-art" viewBox="0 0 320 260" aria-hidden="true">
      <defs>
        <linearGradient id="brainStroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#63f0ff" />
          <stop offset="55%" stopColor="#38a6ff" />
          <stop offset="100%" stopColor="#2f6bff" />
        </linearGradient>
        <radialGradient id="brainFill" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#0f3555" />
          <stop offset="100%" stopColor="#061426" />
        </radialGradient>
        <filter id="brainGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g filter="url(#brainGlow)" strokeLinejoin="round">
        <path
          d="M160 40C142 28 116 34 112 52 92 54 78 74 88 90 74 102 80 126 98 132 96 152 116 166 134 158 142 176 166 178 176 162 196 166 212 150 208 132 224 124 228 100 212 90 220 72 202 54 182 54 176 38 166 34 160 40Z"
          fill="url(#brainFill)"
          stroke="url(#brainStroke)"
          strokeWidth="3"
        />
        <path d="M160 40v120" stroke="url(#brainStroke)" strokeOpacity=".4" strokeWidth="2" />
        <g
          fill="none"
          stroke="url(#brainStroke)"
          strokeWidth="2.4"
          strokeOpacity=".9"
          strokeLinecap="round"
        >
          <path d="M118 72c14 4 18 18 8 26" />
          <path d="M104 106c14-2 24 8 22 20" />
          <path d="M122 140c10-8 24-2 26 10" />
          <path d="M186 66c-12 6-12 22 2 28" />
          <path d="M196 104c-12 2-16 16-6 24" />
          <path d="M182 140c-10-4-20 4-18 14" />
          <path d="M140 54c8 6 10 16 4 24" />
          <path d="M172 150c-8 6-8 14-2 18" />
        </g>
        <path
          d="M152 156c-4 12 2 22 12 24"
          fill="none"
          stroke="url(#brainStroke)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeOpacity=".75"
        />
      </g>
    </svg>
  );
}

export function ConnectFourArt() {
  const preview = [
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 2, 0, 0, 0],
    [0, 0, 1, 1, 0, 0, 0],
    [0, 2, 1, 2, 1, 0, 0],
    [0, 1, 2, 1, 2, 0, 0],
    [1, 2, 1, 2, 1, 2, 1],
  ];
  return (
    <div className="c4-art-frame" aria-hidden="true">
      {preview.map((row, r) => (
        <div key={r} className="c4-art-row">
          {row.map((val, c) => (
            <span
              key={c}
              className={`c4-art-cell ${val === 1 ? 'cell-x' : val === 2 ? 'cell-o' : 'cell-empty'}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function BlasterArt() {
  return (
    <svg
      className="blaster-art-svg"
      viewBox="0 0 320 180"
      width="100%"
      height="100%"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="blasterGlow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#0077ff" stopOpacity="0.2" />
        </linearGradient>
        <filter id="laserBlur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      {/* Grid background */}
      <path
        d="M0 45h320M0 90h320M0 135h320M80 0v180M160 0v180M240 0v180"
        stroke="#00f0ff"
        strokeOpacity="0.08"
        strokeWidth="1"
      />
      {/* Obstacle pillar preview */}
      <rect
        x="145"
        y="60"
        width="30"
        height="60"
        rx="4"
        fill="#0f172a"
        stroke="#00f0ff"
        strokeWidth="1.5"
        strokeOpacity="0.6"
      />
      {/* Laser beams */}
      <line
        x1="85"
        y1="90"
        x2="145"
        y2="90"
        stroke="#00ffff"
        strokeWidth="3"
        filter="url(#laserBlur)"
        strokeLinecap="round"
      />
      <line
        x1="235"
        y1="85"
        x2="175"
        y2="85"
        stroke="#ff2d55"
        strokeWidth="3"
        filter="url(#laserBlur)"
        strokeLinecap="round"
      />
      {/* Ship P1 */}
      <g transform="translate(65, 90)">
        <polygon
          points="18,0 -12,-12 -6,0 -12,12"
          fill="#00f0ff"
          stroke="#0077ff"
          strokeWidth="2"
        />
        <polygon points="6,0 -4,-4 -4,4" fill="#ffffff" />
      </g>
      {/* Ship P2 */}
      <g transform="translate(255, 90) rotate(180)">
        <polygon
          points="18,0 -12,-12 -6,0 -12,12"
          fill="#ff2d55"
          stroke="#ff9500"
          strokeWidth="2"
        />
        <polygon points="6,0 -4,-4 -4,4" fill="#ffffff" />
      </g>
    </svg>
  );
}
