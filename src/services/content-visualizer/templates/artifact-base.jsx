/**
 * Base React template for Content Visualizer Artifacts.
 * Used by ReactArtifactGenerator as the skeleton for generated visualizations.
 *
 * CODE STANDARDS (PRD section 2.4):
 * - Single file, default export, no required props
 * - Tailwind CSS only (no custom CSS imports)
 * - useState/useEffect hooks for state and animation
 * - requestAnimationFrame or CSS transitions for smooth animations
 * - Mobile responsive (touch support)
 * - Dark theme (#0F172A family)
 * - Step-by-step controls (Previous / Next / Play / Pause)
 * - KaTeX for equations (render as SVG text)
 * - Hover + click states on all interactive elements
 * - ARIA labels for accessibility
 * - NEVER use localStorage, sessionStorage, or browser storage APIs
 * - NEVER import external CSS files
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

export default function ContentVisualization() {
  const [currentScene, setCurrentScene] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedElement, setSelectedElement] = useState(null);
  const timerRef = useRef(null);

  const scenes = [
    /* SCENES_PLACEHOLDER */
  ];

  const totalScenes = scenes.length;

  const goToScene = useCallback(
    (index) => {
      if (index >= 0 && index < totalScenes) {
        setCurrentScene(index);
        setSelectedElement(null);
      }
    },
    [totalScenes],
  );

  const nextScene = useCallback(() => {
    goToScene(Math.min(currentScene + 1, totalScenes - 1));
  }, [currentScene, goToScene, totalScenes]);

  const prevScene = useCallback(() => {
    goToScene(Math.max(currentScene - 1, 0));
  }, [currentScene, goToScene]);

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => {
        setCurrentScene((prev) => {
          if (prev >= totalScenes - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 3000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, totalScenes]);

  const scene = scenes[currentScene];

  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-950 p-4 text-slate-100">
      {/* Scene content */}
      <div className="relative mb-6 flex w-full max-w-4xl flex-1 items-center justify-center rounded-xl bg-slate-900 p-8">
        {scene ? scene.render({ selectedElement, setSelectedElement }) : null}
      </div>

      {/* Detail panel */}
      {selectedElement && (
        <div
          aria-label="Detail panel"
          className="mb-4 w-full max-w-4xl rounded-lg border border-slate-700 bg-slate-800 p-4"
        >
          <h3 className="mb-2 text-lg font-semibold">{selectedElement.title}</h3>
          <p className="text-slate-300">{selectedElement.detail}</p>
          <button
            aria-label="Close detail panel"
            className="mt-2 text-sm text-slate-400 hover:text-slate-200"
            onClick={() => setSelectedElement(null)}
            type="button"
          >
            Close
          </button>
        </div>
      )}

      {/* Navigation */}
      <div className="flex w-full max-w-4xl items-center justify-between">
        {/* Scene dots */}
        <div className="flex gap-2" role="tablist">
          {scenes.map((_, i) => (
            <button
              aria-label={`Go to scene ${i + 1}`}
              className={`h-3 w-3 rounded-full transition-colors ${
                i === currentScene ? 'bg-blue-500' : 'bg-slate-600 hover:bg-slate-500'
              }`}
              key={i}
              onClick={() => goToScene(i)}
              role="tab"
              type="button"
            />
          ))}
        </div>

        {/* Controls */}
        <div className="flex gap-3">
          <button
            aria-label="Previous scene"
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm transition-colors hover:bg-slate-700 disabled:opacity-40"
            disabled={currentScene === 0}
            onClick={prevScene}
            type="button"
          >
            Previous
          </button>
          <button
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm transition-colors hover:bg-blue-500"
            onClick={togglePlay}
            type="button"
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            aria-label="Next scene"
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm transition-colors hover:bg-slate-700 disabled:opacity-40"
            disabled={currentScene === totalScenes - 1}
            onClick={nextScene}
            type="button"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
