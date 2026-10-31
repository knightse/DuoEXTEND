// Page layout: own one stylesheet so turning the feature off restores the site's CSS.
// This file runs before content.js in Safari's isolated extension context.
(() => {
    const ACTIVE_MODES = ['slight', 'full'];
    const MAX_DISPLAY_TO_VIEWPORT_RATIO = 1.35;
    // Allow for fractional layout measurements when checking whether the style took effect.
    const WIDTH_TOLERANCE_PX = 2;

    function normalizeWidthMode(savedValue) {
        // The first prototype saved booleans. Old "on" settings now use the gentler mode.
        if (savedValue === true) {
            return 'slight';
        }

        if (ACTIVE_MODES.includes(savedValue)) {
            return savedValue;
        }

        return 'off';
    }

    function createPageLayout(document, window) {
        let extensionStylesheet = null;

        function removeExtensionStyles() {
            // Do not restore an old copy of site styles: the website may have changed them.
            extensionStylesheet?.remove();
            extensionStylesheet = null;
        }

        function applyWidthMode(selectedMode) {
            removeExtensionStyles();

            if (!ACTIVE_MODES.includes(selectedMode)) {
                return false;
            }

            const displayWidth = Number(window.screen.width);
            const viewportWidth = Number(window.innerWidth);
            const isTouchDisplay = window.matchMedia('(pointer: coarse)').matches;
            const hasValidDimensions = Number.isFinite(displayWidth)
                && Number.isFinite(viewportWidth);

            // A small side inset is expected on the Duo. A large mismatch could instead
            // be a narrow browser window; do not stretch that window to the whole screen.
            const hasModestSideInset = displayWidth > viewportWidth + 1
                && displayWidth <= viewportWidth * MAX_DISPLAY_TO_VIEWPORT_RATIO;

            if (!isTouchDisplay || !hasValidDimensions || !hasModestSideInset || !document.head) {
                return false;
            }

            let targetWidth = displayWidth;

            if (selectedMode === 'slight') {
                // Use half the extra side space instead of extending across all of it.
                const extraSideSpace = displayWidth - viewportWidth;
                targetWidth = Math.round(viewportWidth + extraSideSpace / 2);
            }

            // Change only the document root. Leave viewport metadata, zoom and body styles
            // alone. Normal-flow content can extend under controls; fixed elements may differ.
            extensionStylesheet = document.createElement('style');
            extensionStylesheet.textContent = `html { width: ${targetWidth}px !important; max-width: none !important; }`;
            document.head.append(extensionStylesheet);

            const renderedWidth = document.documentElement.getBoundingClientRect().width;
            const wasApplied = Math.abs(renderedWidth - targetWidth) < WIDTH_TOLERANCE_PX;

            if (!wasApplied) {
                // If site constraints defeat the requested width, leave no partial override.
                removeExtensionStyles();
            }

            return wasApplied;
        }

        return {
            apply: applyWidthMode,
            remove: removeExtensionStyles
        };
    }

    // Content scripts are classic scripts, so these helpers are shared through the isolated
    // extension global rather than ES-module imports. They are not added to the site's world.
    globalThis.duoMode = normalizeWidthMode;
    globalThis.createDuoLayout = createPageLayout;
})();
