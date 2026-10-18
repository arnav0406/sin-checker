// entrypoints/content.tsx
import './overlay.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import CodeCheckOverlay from '../components/CodeCheckOverlay';

export default defineContentScript({
  matches: ['*://leetcode.com/problems/*'],
  cssInjectionMode: 'ui', // Injects Tailwind CSS strictly inside our Shadow DOM!

  async main(ctx) {
    // Inject the 3-second yellow line pulse class for Monaco
    const pageStyle = document.createElement('style');
    pageStyle.textContent = `.codecheck-culprit-line { background: rgba(250, 204, 21, 0.25) !important; border-bottom: 1px solid #facc15; }`;
    document.head.appendChild(pageStyle);

    const ui = await createShadowRootUi(ctx, {
      name: 'codecheck-overlay',
      position: 'inline',
      anchor: 'body',
      onMount(container) {
        const wrapper = document.createElement('div');
        container.appendChild(wrapper);
        const root = ReactDOM.createRoot(wrapper);
        root.render(<CodeCheckOverlay />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });

    ui.mount();
  },
});