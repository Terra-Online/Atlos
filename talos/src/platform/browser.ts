/**
 * Browser capability detection utilities
 */

/**
 * Check if the browser supports SVG filters
 * @returns true if SVG filters are supported, false otherwise
 */
export const supportsSVGFilters = (): boolean => {
  // Check if running in a browser environment
  if (typeof document === 'undefined') {
    return false;
  }

  try {
    // Create a test SVG element
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    const feGaussianBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');

    // Check if SVG filter elements can be created
    if (!svg || !filter || !feGaussianBlur) {
      return false;
    }

    // Check for filter property support
    const testElement = document.createElement('div');
    testElement.style.filter = 'url(#test)';
    
    return testElement.style.filter !== '';
  } catch (error) {
    console.warn('SVG filter detection failed:', error);
    return false;
  }
};

/**
 * Check if the browser has good performance for complex visual effects
 * This is a heuristic based on user agent and known limitations
 * @returns true if performance mode should be recommended
 */
export const shouldUsePerformanceMode = (): boolean => {
  // If SVG filters are not supported, definitely use performance mode
  if (!supportsSVGFilters()) {
    return true;
  }

  // Check for low-end devices or browsers with known performance issues
  if (typeof navigator === 'undefined') {
    return false;
  }

  const ua = navigator.userAgent.toLowerCase();

  // Check for known problematic browsers or versions
  // Old Safari versions have poor SVG filter performance
  if (ua.includes('safari') && !ua.includes('chrome')) {
    const versionMatch = ua.match(/version\/(\d+)/);
    if (versionMatch && parseInt(versionMatch[1]) < 15) {
      return true;
    }
  }

  // Could add more browser/device checks here if needed
  
  return false;
};
