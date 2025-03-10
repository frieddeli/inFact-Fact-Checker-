/**
 * @fileoverview Content script for the Fact Checker extension.
 * Handles displaying fact check results in a draggable and resizable box.
 */

(function() {
  // Constants
  const CONTAINER_ID = 'perplexity-fact-check-box';
  const CLOSE_BTN_ID = 'close-fact-check';
  const COPY_BTN_ID = 'copy-result';
  const TRUTH_METER_ID = 'truth-percentage';
  const SECONDARY_CONTAINER_ID = 'perplexity-secondary-box';
  const SECONDARY_CLOSE_BTN_ID = 'close-secondary';
  const MIN_SIZE = 200;
  const EDGE_MARGIN = 10;
  const BTN_DELAY = 100;
  const COPY_RESET_DELAY = 2000;
  
  // Prevent multiple injections
  if (window.perplexityFactCheckerInjected) {
    return;
  }
  window.perplexityFactCheckerInjected = true;

  // State variables
  let resultContainer = null;
  let secondaryContainer = null;
  
  // Track mouse position for context menu positioning
  window.lastMousePosition = { x: 100, y: 100 };
  document.addEventListener('mousemove', (e) => {
    window.lastMousePosition = { x: e.clientX, y: e.clientY };
  });

  /**
   * Listens for messages from the background script.
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Received message in content script:', request);
    try {
      switch (request.action) {
        case 'checkInjection':
          console.log('Responding to checkInjection');
          sendResponse({ injected: true });
          break;
        case 'showLoading':
          console.log('Showing loader');
          displayLoader();
          break;
        case 'factCheckResult':
          console.log('Displaying fact check result');
          displayResult(request.data);
          break;
        case 'factCheckError':
          console.log('Displaying error');
          displayError(request.error);
          break;
        case 'showSecondaryResult':
          console.log('Showing secondary result');
          showSecondaryResult(request.data);
          sendResponse({ success: true });
          break;
        case 'scrapeYouTubeTranscript':
          console.log('Scraping YouTube transcript');
          scrapeYouTubeTranscript()
            .then(transcript => {
              console.log('Transcript scraped successfully');
              sendResponse({ success: true, transcript });
            })
            .catch(error => {
              console.error('Error scraping transcript:', error);
              sendResponse({ success: false, error: error.message });
            });
          return true; // Indicates we'll respond asynchronously
          break;
        default:
          console.log('Unknown action:', request.action);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ error: error.message });
    }
    // Return true to indicate we'll respond asynchronously
    return true;
  });

  /**
   * Shows loading indicator in the fact check box.
   */
  function displayLoader() {
    if (!resultContainer) {
      resultContainer = createContainer();
    }
    resultContainer.innerHTML = `
      <div class="fact-check-header">
        <h2>Fact Checker</h2>
        <button id="${CLOSE_BTN_ID}">×</button>
      </div>
      <p>Loading... This may take a few moments.</p>
      <div class="loader"></div>
    `;
    resultContainer.style.display = 'block';
    setupCloseButton();
  }

  /**
   * Shows fact check result in the fact check box.
   * 
   * @param {string} result - The raw fact check result from the API
   */
  function displayResult(result) {
    console.log('Showing fact check result:', result);
    if (!resultContainer) {
      resultContainer = createContainer();
    }
    const parsedData = parseResult(result);
    updateContainer(parsedData);
  }

  /**
   * Creates the fact check box element.
   * 
   * @returns {HTMLElement} The created fact check box
   */
  function createContainer() {
    const box = document.createElement('div');
    box.id = CONTAINER_ID;
    document.body.appendChild(box);
    makeInteractive(box);
    return box;
  }

  /**
   * Updates the fact check box with the parsed result.
   * 
   * @param {Object} data - The parsed fact check result
   */
  function updateContainer(data) {
    console.log('Updating fact check box with:', data);
    const colorCode = getColorForTruth(data.truthPercentage);
    console.log('Truth color:', colorCode);
    
    // Check if we have both Perplexity and Groq results
    const hasMultipleResults = data.factCheck.includes('(Perplexity)') && data.factCheck.includes('(Groq)');
    
    let factCheckContent = '';
    let contextContent = '';
    
    if (hasMultipleResults) {
      // Split the fact check and context sections
      const perplexityFactCheck = data.factCheck.split('Fact Check (Groq)')[0].replace('Fact Check (Perplexity):', '').trim();
      const groqFactCheck = data.factCheck.split('Fact Check (Groq):')[1].trim();
      
      factCheckContent = `
        <h4>Fact Check (Perplexity):</h4>
        <p>${perplexityFactCheck}</p>
        <h4>Fact Check (Groq):</h4>
        <p>${groqFactCheck}</p>
      `;
      
      if (data.context.includes('Additional Context')) {
        const mainContext = data.context.split('Additional Context')[0].trim();
        const additionalContext = data.context.split('Additional Context:')[1].trim();
        
        contextContent = `
          <h4>Context:</h4>
          <p>${mainContext}</p>
          <h4>Additional Context:</h4>
          <p>${additionalContext}</p>
        `;
      } else {
        contextContent = `
          <h4>Context:</h4>
          <p>${data.context}</p>
        `;
      }
    } else {
      // Single result format
      factCheckContent = `
        <h4>Fact Check:</h4>
        <p>${data.factCheck}</p>
      `;
      
      contextContent = `
        <h4>Context:</h4>
        <p>${data.context}</p>
      `;
    }
    
    resultContainer.innerHTML = `
      <div class="fact-check-header">
        <h2>Fact Checker</h2>
        <button id="${CLOSE_BTN_ID}">×</button>
      </div>
      <h3 id="${TRUTH_METER_ID}">Truth Percentage: <span style="color: ${colorCode} !important;">${data.truthPercentage}</span></h3>
      ${factCheckContent}
      ${contextContent}
      <h4>Sources:</h4>
      <ol>
        ${data.sources.map(source => `<li value="${source.index}"><a href="${source.url}" target="_blank">${source.title}</a></li>`).join('')}
      </ol>
      <button id="${COPY_BTN_ID}">Copy Result</button>
    `;
    
    resultContainer.style.display = 'block';
    setupCloseButton();
    setupCopyButton(data);
  }

  /**
   * Parses the raw fact check result into a structured object.
   * 
   * @param {string} result - The raw fact check result from the API
   * @returns {Object} The parsed result with truthPercentage, factCheck, context, and sources
   */
  function parseResult(result) {
    console.log('Parsing raw result:', result);

    const sections = result.split('\n\n');
    const data = {
      truthPercentage: 'N/A',
      factCheck: 'No fact check provided.',
      context: 'No context provided.',
      sources: []
    };

    let currentSection = '';

    sections.forEach(section => {
      if (section.startsWith('Sources:')) {
        currentSection = 'sources';
        extractSources(section, data);
      } else if (section.startsWith('Truth:')) {
        currentSection = 'truth';
        data.truthPercentage = section.split(':')[1].trim();
      } else if (section.startsWith('Fact Check:')) {
        currentSection = 'factCheck';
        data.factCheck = section.split(':').slice(1).join(':').trim();
      } else if (section.startsWith('Context:')) {
        currentSection = 'context';
        data.context = section.split(':').slice(1).join(':').trim();
      } else if (currentSection === 'factCheck') {
        data.factCheck += ' ' + section.trim();
      } else if (currentSection === 'context') {
        data.context += ' ' + section.trim();
      }
    });

    console.log('Parsed result:', data);

    // Replace source references with hyperlinks
    data.factCheck = linkifyReferences(data.factCheck, data.sources);
    data.context = linkifyReferences(data.context, data.sources);

    return data;
  }

  /**
   * Parses the sources section of the fact check result.
   * 
   * @param {string} section - The sources section text
   * @param {Object} data - The result object to update with sources
   */
  function extractSources(section, data) {
    const sourceLines = section.split('\n').slice(1);
    console.log('Source lines:', sourceLines);
    
    sourceLines.forEach(line => {
      const match = line.match(/(\d+)\.\s+(.+)/);
      if (match) {
        const [, index, content] = match;
        const urlMatch = content.match(/\[(.+?)\]\((.+?)\)/);
        if (urlMatch) {
          data.sources.push({ index, title: urlMatch[1], url: urlMatch[2] });
        } else {
          data.sources.push({ index, title: content, url: '#' });
        }
      }
    });
  }

  /**
   * Replaces source references in text with hyperlinks.
   * 
   * @param {string} text - The text containing source references
   * @param {Array} sources - The array of source objects
   * @returns {string} The text with source references replaced with hyperlinks
   */
  function linkifyReferences(text, sources) {
    return text.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (match, p1) => {
      const indices = p1.split(',').map(s => s.trim());
      const links = indices.map(index => {
        const source = sources.find(s => s.index === index);
        if (source) {
          return `<a href="${source.url}" target="_blank">[${index}]</a>`;
        }
        return `[${index}]`;
      });
      return links.join(', ');
    });
  }

  /**
   * Gets the color for the truth percentage.
   * 
   * @param {string} percentage - The truth percentage
   * @returns {string} The color for the truth percentage
   */
  function getColorForTruth(percentage) {
    console.log('Received percentage:', percentage);
    const value = parseInt(percentage);
    console.log('Parsed value:', value);
    
    if (isNaN(value)) {
      console.log('Returning black due to NaN');
      return 'black';
    }
    
    if (value >= 80) return 'green';
    if (value >= 60) return 'goldenrod';
    if (value >= 40) return 'orange';
    return 'red';
  }

  /**
   * Shows an error message in the fact check box using the same window and formatting as displayResult().
   * 
   * @param {string} message - The error message to display
   */
  function displayError(message) {
    console.error('Showing error:', message);
    if (!resultContainer) {
      resultContainer = createContainer();
    }
    
    // Create a data object similar to what parseResult() would return
    const data = {
      truthPercentage: 'N/A',
      factCheck: message,
      context: 'An error occurred while processing your request.',
      sources: []
    };
    
    // Use the same updateContainer function as displayResult
    updateContainer(data);
  }

  /**
   * Adds a click listener to the close button.
   */
  function setupCloseButton() {
    setTimeout(() => {
      const closeBtn = document.getElementById(CLOSE_BTN_ID);
      if (closeBtn) {
        console.log('Close button found, adding event listener');
        closeBtn.addEventListener('click', () => {
          console.log('Close button clicked');
          if (resultContainer) {
            resultContainer.style.display = 'none';
          }
        });
      } else {
        console.log('Close button not found');
      }
    }, BTN_DELAY);
  }

  /**
   * Adds a click listener to the copy button.
   * 
   * @param {Object} data - The parsed fact check result
   */
  function setupCopyButton(data) {
    const copyBtn = document.getElementById(COPY_BTN_ID);
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const formattedText = formatForClipboard(data);
        navigator.clipboard.writeText(formattedText).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.textContent = 'Copy Result';
          }, COPY_RESET_DELAY);
        });
      });
    }
  }

  /**
   * Formats the result for copying to clipboard.
   * 
   * @param {Object} data - The parsed fact check result
   * @returns {string} The formatted text for copying
   */
  function formatForClipboard(data) {
    // Check if we have both Perplexity and Groq results
    const hasMultipleResults = data.factCheck.includes('(Perplexity)') && data.factCheck.includes('(Groq)');
    
    let formattedText = `Truth Percentage: ${data.truthPercentage}\n\n`;
    
    if (hasMultipleResults) {
      // Split the fact check and context sections
      const perplexityFactCheck = data.factCheck.split('Fact Check (Groq)')[0].replace('Fact Check (Perplexity):', '').trim();
      const groqFactCheck = data.factCheck.split('Fact Check (Groq):')[1].trim();
      
      formattedText += `Fact Check (Perplexity): ${perplexityFactCheck}\n\n`;
      formattedText += `Fact Check (Groq): ${groqFactCheck}\n\n`;
      
      if (data.context.includes('Additional Context')) {
        const mainContext = data.context.split('Additional Context')[0].trim();
        const additionalContext = data.context.split('Additional Context:')[1].trim();
        
        formattedText += `Context: ${mainContext}\n\n`;
        formattedText += `Additional Context: ${additionalContext}\n\n`;
      } else {
        formattedText += `Context: ${data.context}\n\n`;
      }
    } else {
      formattedText += `Fact Check: ${data.factCheck}\n\n`;
      formattedText += `Context: ${data.context}\n\n`;
    }
    
    formattedText += `Sources:\n${data.sources.map(source => `${source.index}. ${source.title} - ${source.url}`).join('\n')}`;
    
    return formattedText.trim();
  }

  /**
   * Checks if the user's system is in dark mode.
   * 
   * @returns {boolean} True if the system is in dark mode
   */
  function isDarkMode() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /**
   * Makes an element draggable and resizable.
   * 
   * @param {HTMLElement} element - The element to make draggable and resizable
   */
  function makeInteractive(element) {
    let isResizing = false;
    let isDragging = false;
    let startX, startY, startWidth, startHeight, startLeft, startTop;
    let resizeDirection = '';

    element.addEventListener('mousedown', startInteraction);
    document.addEventListener('mousemove', handleInteraction);
    document.addEventListener('mouseup', endInteraction);
    element.addEventListener('mousemove', updateMouseCursor);

    /**
     * Starts dragging or resizing the element.
     * 
     * @param {MouseEvent} e - The mouse event
     */
    function startInteraction(e) {
      if (isNearBorder(e, element)) {
        isResizing = true;
        resizeDirection = getDirection(e, element);
      } else {
        isDragging = true;
      }
      startX = e.clientX;
      startY = e.clientY;
      startWidth = element.offsetWidth;
      startHeight = element.offsetHeight;
      startLeft = element.offsetLeft;
      startTop = element.offsetTop;
      e.preventDefault();
    }

    /**
     * Handles dragging or resizing the element.
     * 
     * @param {MouseEvent} e - The mouse event
     */
    function handleInteraction(e) {
      if (isResizing) {
        handleResize(e);
      } else if (isDragging) {
        handleDrag(e);
      }
    }

    /**
     * Resizes the element.
     * 
     * @param {MouseEvent} e - The mouse event
     */
    function handleResize(e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (resizeDirection.includes('w')) {
        element.style.width = `${Math.max(MIN_SIZE, startWidth - dx)}px`;
        element.style.left = `${startLeft + dx}px`;
      } else if (resizeDirection.includes('e')) {
        element.style.width = `${Math.max(MIN_SIZE, startWidth + dx)}px`;
      }

      if (resizeDirection.includes('n')) {
        element.style.height = `${Math.max(MIN_SIZE, startHeight - dy)}px`;
        element.style.top = `${startTop + dy}px`;
      } else if (resizeDirection.includes('s')) {
        element.style.height = `${Math.max(MIN_SIZE, startHeight + dy)}px`;
      }
    }

    /**
     * Drags the element.
     * 
     * @param {MouseEvent} e - The mouse event
     */
    function handleDrag(e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      element.style.left = `${startLeft + dx}px`;
      element.style.top = `${startTop + dy}px`;
    }

    /**
     * Stops dragging or resizing the element.
     */
    function endInteraction() {
      isResizing = false;
      isDragging = false;
      resizeDirection = '';
      element.style.cursor = 'default';
    }

    /**
     * Updates the cursor based on the mouse position.
     * 
     * @param {MouseEvent} e - The mouse event
     */
    function updateMouseCursor(e) {
      const direction = getDirection(e, element);
      if (direction) {
        element.style.cursor = getCursorStyle(direction);
      } else {
        element.style.cursor = 'move';
      }
    }

    /**
     * Checks if the mouse is near an edge of the element.
     * 
     * @param {MouseEvent} e - The mouse event
     * @param {HTMLElement} element - The element to check
     * @returns {boolean} True if the mouse is near an edge
     */
    function isNearBorder(e, element) {
      const rect = element.getBoundingClientRect();
      return (
        e.clientX < rect.left + EDGE_MARGIN ||
        e.clientX > rect.right - EDGE_MARGIN ||
        e.clientY < rect.top + EDGE_MARGIN ||
        e.clientY > rect.bottom - EDGE_MARGIN
      );
    }

    /**
     * Gets the resize direction based on the mouse position.
     * 
     * @param {MouseEvent} e - The mouse event
     * @param {HTMLElement} element - The element to check
     * @returns {string} The resize direction (n, s, e, w, ne, nw, se, sw)
     */
    function getDirection(e, element) {
      const rect = element.getBoundingClientRect();
      let direction = '';

      if (e.clientY < rect.top + EDGE_MARGIN) direction += 'n';
      else if (e.clientY > rect.bottom - EDGE_MARGIN) direction += 's';

      if (e.clientX < rect.left + EDGE_MARGIN) direction += 'w';
      else if (e.clientX > rect.right - EDGE_MARGIN) direction += 'e';

      return direction;
    }

    /**
     * Gets the cursor style based on the resize direction.
     * 
     * @param {string} direction - The resize direction
     * @returns {string} The cursor style
     */
    function getCursorStyle(direction) {
      switch (direction) {
        case 'n':
        case 's':
          return 'ns-resize';
        case 'e':
        case 'w':
          return 'ew-resize';
        case 'nw':
        case 'se':
          return 'nwse-resize';
        case 'ne':
        case 'sw':
          return 'nesw-resize';
        default:
          return 'move';
      }
    }
  }

  /**
   * Checks if the user's system is in dark mode.
   * 
   * @returns {boolean} True if the system is in dark mode
   */
  function isDarkMode() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /**
   * Creates the secondary popup box element.
   * 
   * @returns {HTMLElement} The created secondary popup box
   */
  function createSecondaryContainer() {
    const box = document.createElement('div');
    box.id = SECONDARY_CONTAINER_ID;
    document.body.appendChild(box);
    makeInteractive(box);
    return box;
  }

  /**
   * Shows loading indicator in the secondary popup box with context menu styling.
   */
  function displaySecondaryLoader() {
    if (!secondaryContainer) {
      secondaryContainer = createSecondaryContainer();
    }
    
    // Position near the mouse cursor if possible
    if (window.lastMousePosition) {
      secondaryContainer.style.top = `${window.lastMousePosition.y}px`;
      secondaryContainer.style.left = `${window.lastMousePosition.x}px`;
    }
    
    secondaryContainer.innerHTML = `
      <div class="context-menu-header">
        <span class="truth-indicator" style="background-color: gray;"></span>
        <span class="truth-text">Fact Checking...</span>
        <button id="${SECONDARY_CLOSE_BTN_ID}" class="context-close">×</button>
      </div>
      <div class="context-menu-content">
        <div class="context-section" style="text-align: center;">
          <p class="context-info">Loading... This may take a few moments.</p>
          <div class="loader" style="margin: 15px auto;"></div>
        </div>
      </div>
    `;
    secondaryContainer.style.display = 'block';
    setupSecondaryCloseButton();
  }

  /**
   * Updates the secondary popup box with the parsed result in a context menu style format.
   * 
   * @param {Object} data - The parsed result data
   */
  function updateSecondaryContainer(data) {
    console.log('Updating secondary popup box with:', data);
    const colorCode = getColorForTruth(data.truthPercentage);
    
    // Position near the mouse cursor if possible
    if (window.lastMousePosition) {
      secondaryContainer.style.top = `${window.lastMousePosition.y}px`;
      secondaryContainer.style.left = `${window.lastMousePosition.x}px`;
    }
    
    secondaryContainer.innerHTML = `
      <div class="context-menu-header">
        <span class="truth-indicator" style="background-color: ${colorCode};"></span>
        <span class="truth-text">Truth: ${data.truthPercentage}</span>
        <button id="${SECONDARY_CLOSE_BTN_ID}" class="context-close">×</button>
      </div>
      <div class="context-menu-content">
        <div class="context-section">
          <p class="context-fact">${data.factCheck}</p>
        </div>
        <div class="context-section">
          <p class="context-info">${data.context}</p>
        </div>
        ${data.sources.length > 0 ? `
        <div class="context-section sources-section">
          <div class="sources-list">
            ${data.sources.map(source => `
              <a href="${source.url}" target="_blank" class="source-link">
                <span class="source-number">[${source.index}]</span> ${source.title}
              </a>
            `).join('')}
          </div>
        </div>
        ` : ''}
      </div>
    `;
    
    secondaryContainer.style.display = 'block';
    setupSecondaryCloseButton();
  }

  /**
   * Shows result in the secondary popup box, closing the existing popup first.
   * Uses the same format as the right-click context menu search result.
   * 
   * @param {string} result - The raw result data
   */
  function showSecondaryResult(result) {
    console.log('Showing result in secondary window:', result);
    
    // Close the existing popup if it exists
    if (resultContainer) {
      resultContainer.style.display = 'none';
    }
    
    // First show the loader
    displaySecondaryLoader();
    
    // Then after a delay, show the result
    setTimeout(() => {
      if (!secondaryContainer) {
        secondaryContainer = createSecondaryContainer();
      }
      const parsedData = parseResult(result);
      updateSecondaryContainer(parsedData);
    }, 1500); // Simulate loading time
  }

  /**
   * Adds a click listener to the secondary close button.
   */
  function setupSecondaryCloseButton() {
    setTimeout(() => {
      const closeBtn = document.getElementById(SECONDARY_CLOSE_BTN_ID);
      if (closeBtn) {
        console.log('Secondary close button found, adding event listener');
        closeBtn.addEventListener('click', () => {
          console.log('Secondary close button clicked');
          if (secondaryContainer) {
            secondaryContainer.style.display = 'none';
          }
        });
      } else {
        console.log('Secondary close button not found');
      }
    }, BTN_DELAY);
  }
  
  /**
   * Scrapes the transcript from a YouTube video page.
   * 
   * @returns {Promise<string>} The transcript text
   */
  async function scrapeYouTubeTranscript() {
    return new Promise((resolve, reject) => {
      // Check if we're on a YouTube video page
      if (!window.location.href.includes('youtube.com/watch')) {
        reject(new Error('Not a YouTube video page'));
        return;
      }
      
      console.log('Attempting to scrape YouTube transcript');
      
      // First, try to find an already open transcript panel
      let transcriptPanel = document.querySelector('ytd-transcript-renderer, ytd-transcript-search-panel-renderer');
      
      if (transcriptPanel) {
        console.log('Transcript panel already open, extracting text');
        extractTranscriptText(transcriptPanel)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      // Try to find and click "more" buttons first, then look for transcript
      tryFindingTranscriptWithMoreButtons(resolve, reject);
    });
  }
  
  /**
   * Tries to find and click "more" buttons, then look for transcript button.
   * 
   * @param {Function} resolve - The promise resolve function
   * @param {Function} reject - The promise reject function
   */
  function tryFindingTranscriptWithMoreButtons(resolve, reject) {
    // First, try to find and click any "Show more" or "...more" buttons
    const moreButtonClicked = tryClickingMoreButton();
    
    // Wait a bit for the UI to update after clicking "more" buttons
    setTimeout(() => {
      // Try to find the transcript button directly
      const directTranscriptButton = findTranscriptButtonDirect();
      
      if (directTranscriptButton) {
        try {
          console.log('Found direct transcript button, clicking it');
          // Make sure it's a valid element with a click method
          if (typeof directTranscriptButton.click === 'function') {
            directTranscriptButton.click();
          } else {
            // If it doesn't have a click method, try other approaches
            console.log('Element does not have click method, trying alternative approaches');
            // Try using dispatchEvent
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window
            });
            directTranscriptButton.dispatchEvent(clickEvent);
          }
          
          // Wait for the transcript panel to appear
          setTimeout(() => {
            const transcriptPanel = document.querySelector('ytd-transcript-renderer, ytd-transcript-search-panel-renderer');
            
            if (transcriptPanel) {
              console.log('Transcript panel found after clicking direct button, extracting text');
              extractTranscriptText(transcriptPanel)
                .then(resolve)
                .catch(reject);
            } else {
              // If transcript panel didn't appear, try the more actions method
              tryMoreActionsMethod(resolve, reject);
            }
          }, 1000);
        } catch (error) {
          console.error('Error clicking transcript button:', error);
          // If there was an error clicking the button, try the more actions method
          tryMoreActionsMethod(resolve, reject);
        }
      } else {
        // If no direct transcript button was found, try the more actions method
        tryMoreActionsMethod(resolve, reject);
      }
    }, moreButtonClicked ? 1000 : 0); // Wait longer if we clicked a "more" button
  }
  
  /**
   * Tries to find and click any "Show more" or "...more" buttons in the page.
   * 
   * @returns {boolean} True if a "more" button was found and clicked
   */
  function tryClickingMoreButton() {
    console.log('Looking for "more" buttons to expand content');
    
    // Look for elements containing "more" text that might be buttons
    const moreButtonSelectors = [
      'button',
      'tp-yt-paper-button',
      'yt-formatted-string[role="button"]',
      'div[role="button"]',
      'span[role="button"]',
      'a[role="button"]'
    ];
    
    let moreButtonFound = false;
    
    // Try each selector
    for (const selector of moreButtonSelectors) {
      const elements = document.querySelectorAll(selector);
      
      for (const element of elements) {
        // Check if the element is visible and contains "more" text
        if (element.offsetParent !== null && 
            element.textContent && 
            (element.textContent.toLowerCase().includes('more') || 
             element.textContent.includes('...') || 
             element.textContent.includes('…'))) {
          
          console.log('Found potential "more" button:', element);
          
          // Click the button
          element.click();
          moreButtonFound = true;
          
          // We might have multiple "more" buttons, so continue looking
        }
      }
    }
    
    // Also look for the "Show transcript" button in the description
    const descriptionElement = document.querySelector('#description, ytd-video-description-renderer');
    if (descriptionElement) {
      const moreButtons = Array.from(descriptionElement.querySelectorAll('button, span, div, yt-formatted-string'))
        .filter(el => 
          el.offsetParent !== null && 
          el.textContent && 
          (el.textContent.toLowerCase().includes('more') || 
           el.textContent.includes('...') || 
           el.textContent.includes('…'))
        );
      
      for (const button of moreButtons) {
        console.log('Found "more" button in description:', button);
        button.click();
        moreButtonFound = true;
      }
    }
    
    return moreButtonFound;
  }
  
  /**
   * Directly searches for transcript button without clicking "more" buttons first.
   * 
   * @returns {HTMLElement|null} The transcript button element or null if not found
   */
  function findTranscriptButtonDirect() {
    // Try various selectors that might contain the transcript button
    const possibleButtons = [
      ...document.querySelectorAll('button'),
      ...document.querySelectorAll('yt-formatted-string'),
      ...document.querySelectorAll('span'),
      ...document.querySelectorAll('div[role="button"]')
    ];
    
    // Look for elements containing "transcript" text
    for (const element of possibleButtons) {
      if (element.textContent && 
          element.textContent.toLowerCase().includes('transcript') && 
          element.offsetParent !== null) { // Check if element is visible
        console.log('Found potential transcript button:', element);
        return element;
      }
    }
    
    // Try to find the engagement panel section with transcript
    const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
    for (const panel of panels) {
      if (panel.textContent && panel.textContent.toLowerCase().includes('transcript')) {
        const buttons = panel.querySelectorAll('button, div[role="button"]');
        if (buttons.length > 0) {
          console.log('Found transcript button in engagement panel:', buttons[0]);
          return buttons[0];
        }
      }
    }
    
    // Look specifically in the description area
    const descriptionElement = document.querySelector('#description, ytd-video-description-renderer');
    if (descriptionElement) {
      const transcriptButtons = Array.from(descriptionElement.querySelectorAll('button, span, div, yt-formatted-string'))
        .filter(el => 
          el.offsetParent !== null && 
          el.textContent && 
          el.textContent.toLowerCase().includes('transcript')
        );
      
      if (transcriptButtons.length > 0) {
        console.log('Found transcript button in description:', transcriptButtons[0]);
        return transcriptButtons[0];
      }
    }
    
    return null;
  }
  
  /**
   * Tries to open the transcript using the more actions button method.
   * 
   * @param {Function} resolve - The promise resolve function
   * @param {Function} reject - The promise reject function
   */
  function tryMoreActionsMethod(resolve, reject) {
    console.log('Trying more actions method to find transcript');
    
    // Try multiple selectors for the more actions button
    const moreActionsSelectors = [
      'button.ytp-button[aria-label="More actions"]',
      'button.ytp-settings-button',
      'button[aria-label="More actions"]',
      'button[aria-label="Settings"]',
      'button.ytp-button[data-tooltip-target-id="ytp-settings-button"]',
      'button.ytp-settings-button[aria-haspopup="true"]'
    ];
    
    let moreActionsButton = null;
    for (const selector of moreActionsSelectors) {
      const button = document.querySelector(selector);
      if (button && button.offsetParent !== null) { // Check if button is visible
        moreActionsButton = button;
        console.log(`Found more actions button using selector: ${selector}`, button);
        break;
      }
    }
    
    // If still not found, try to find any button that might be the settings/more actions
    if (!moreActionsButton) {
      const allButtons = document.querySelectorAll('button.ytp-button');
      for (const button of allButtons) {
        if (button.offsetParent !== null) { // Check if button is visible
          console.log('Potential more actions button:', button);
          if (button.querySelector('svg') || 
              button.textContent.includes('...') || 
              button.getAttribute('aria-label')?.includes('action') ||
              button.getAttribute('aria-label')?.includes('setting')) {
            moreActionsButton = button;
            console.log('Found potential more actions button with icon or label:', button);
            break;
          }
        }
      }
    }
    
    if (!moreActionsButton) {
      // Try one more approach - look for the player controls
      const playerControls = document.querySelector('.ytp-chrome-bottom, .ytp-chrome-controls');
      if (playerControls) {
        const buttons = playerControls.querySelectorAll('button');
        // Usually the more actions/settings button is one of the last buttons
        for (let i = buttons.length - 1; i >= 0; i--) {
          if (buttons[i].offsetParent !== null) { // Check if button is visible
            moreActionsButton = buttons[i];
            console.log('Found potential more actions button in player controls:', buttons[i]);
            break;
          }
        }
      }
    }
    
    if (!moreActionsButton) {
      // Try to find transcript directly in the page
      const transcriptPanel = findTranscriptPanelInPage();
      if (transcriptPanel) {
        console.log('Found transcript panel directly in page, extracting text');
        extractTranscriptText(transcriptPanel)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      reject(new Error('Could not find more actions button or transcript panel'));
      return;
    }
    
    // Click the more actions button to open the menu
    console.log('Clicking more actions button');
    moreActionsButton.click();
    
    // Wait for the menu to appear and find the "Show transcript" option
    setTimeout(() => {
      // Try multiple selectors for menu items
      const menuItemSelectors = [
        '.ytp-menuitem',
        '.ytp-panel-menu .ytp-menuitem',
        '.ytp-settings-menu .ytp-menuitem',
        'div[role="menuitem"]'
      ];
      
      let menuItems = [];
      for (const selector of menuItemSelectors) {
        const items = document.querySelectorAll(selector);
        if (items.length > 0) {
          menuItems = Array.from(items);
          console.log(`Found menu items using selector: ${selector}`, items);
          break;
        }
      }
      
      // If no menu items found, try to find any elements that appeared after clicking
      if (menuItems.length === 0) {
        const possibleMenus = document.querySelectorAll('.ytp-popup, .ytp-settings-menu, .ytp-panel');
        for (const menu of possibleMenus) {
          if (menu.offsetParent !== null) { // Check if menu is visible
            menuItems = Array.from(menu.querySelectorAll('div, span, button'));
            console.log('Found potential menu items in popup:', menuItems);
            break;
          }
        }
      }
      
      const showTranscriptItem = menuItems.find(item => {
        return item.textContent && item.textContent.toLowerCase().includes('transcript');
      });
      
      if (!showTranscriptItem) {
        // Close the menu by clicking elsewhere
        document.body.click();
        
        // Try to find transcript directly in the page as a last resort
        const transcriptPanel = findTranscriptPanelInPage();
        if (transcriptPanel) {
          console.log('Found transcript panel directly in page, extracting text');
          extractTranscriptText(transcriptPanel)
            .then(resolve)
            .catch(reject);
          return;
        }
        
        reject(new Error('Could not find Show transcript option'));
        return;
      }
      
      // Click the "Show transcript" option
      console.log('Clicking Show transcript option');
      showTranscriptItem.click();
      
      // Wait for the transcript panel to appear
      setTimeout(() => {
        const transcriptPanel = document.querySelector('ytd-transcript-renderer, ytd-transcript-search-panel-renderer');
        
        if (!transcriptPanel) {
          // Try to find transcript directly in the page as a last resort
          const directPanel = findTranscriptPanelInPage();
          if (directPanel) {
            console.log('Found transcript panel directly in page after clicking, extracting text');
            extractTranscriptText(directPanel)
              .then(resolve)
              .catch(reject);
            return;
          }
          
          reject(new Error('Transcript panel did not appear'));
          return;
        }
        
        console.log('Transcript panel found, extracting text');
        extractTranscriptText(transcriptPanel)
          .then(resolve)
          .catch(reject);
      }, 1500);
    }, 1000);
  }
  
  /**
   * Tries to find a transcript panel directly in the page.
   * 
   * @returns {HTMLElement|null} The transcript panel element or null if not found
   */
  function findTranscriptPanelInPage() {
    // Try various selectors that might contain the transcript
    const selectors = [
      'ytd-transcript-renderer',
      'ytd-transcript-search-panel-renderer',
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-transcript"]',
      '#engagement-panel-transcript'
    ];
    
    for (const selector of selectors) {
      const panel = document.querySelector(selector);
      if (panel && panel.offsetParent !== null) { // Check if panel is visible
        console.log(`Found transcript panel using selector: ${selector}`, panel);
        return panel;
      }
    }
    
    // Try to find any panel that might contain transcript
    const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
    for (const panel of panels) {
      if (panel.offsetParent !== null && // Check if panel is visible
          panel.textContent && 
          panel.textContent.toLowerCase().includes('transcript')) {
        console.log('Found potential transcript panel by content:', panel);
        return panel;
      }
    }
    
    return null;
  }
  
  /**
   * Extracts the transcript text from the transcript panel.
   * 
   * @param {HTMLElement} transcriptPanel - The transcript panel element
   * @returns {Promise<string>} The transcript text
   */
  async function extractTranscriptText(transcriptPanel) {
    return new Promise((resolve, reject) => {
      // Wait a bit for the transcript content to fully load
      setTimeout(() => {
        try {
          // Find all transcript segments
          const segments = transcriptPanel.querySelectorAll('ytd-transcript-segment-renderer');
          
          if (!segments || segments.length === 0) {
            reject(new Error('No transcript segments found'));
            return;
          }
          
          console.log(`Found ${segments.length} transcript segments`);
          
          // Extract text from each segment
          const transcriptLines = Array.from(segments).map(segment => {
            const textElement = segment.querySelector('.segment-text');
            return textElement ? textElement.textContent.trim() : '';
          }).filter(text => text); // Remove empty lines
          
          // Join the lines into a single text
          const transcriptText = transcriptLines.join(' ');
          
          console.log('Extracted transcript text:', transcriptText.substring(0, 100) + '...');
          resolve(transcriptText);
        } catch (error) {
          console.error('Error extracting transcript text:', error);
          reject(error);
        }
      }, 1000);
    });
  }

  /**
   * Creates and appends the styles for the fact check box.
   */
  const style = document.createElement('style');
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Satoshi:wght@400;700&display=swap');

    /* Context menu styles for secondary container */
    #${SECONDARY_CONTAINER_ID} {
      position: fixed;
      top: 100px;
      left: 100px;
      width: 320px;
      max-height: 450px;
      overflow-y: auto;
      background-color: ${isDarkMode() ? '#222' : '#fff'};
      color: ${isDarkMode() ? '#eee' : '#333'} !important;
      border: 1px solid ${isDarkMode() ? '#444' : '#ddd'};
      border-radius: 8px;
      padding: 0;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 9999;
      font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    }
    
    /* Context menu header */
    .context-menu-header {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid ${isDarkMode() ? '#444' : '#eee'};
      background-color: ${isDarkMode() ? '#333' : '#f8f8f8'};
      border-radius: 8px 8px 0 0;
    }
    
    .truth-indicator {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      margin-right: 8px;
    }
    
    .truth-text {
      font-weight: 600;
      font-size: 14px;
      flex-grow: 1;
      color: ${isDarkMode() ? '#eee' : '#333'} !important;
    }
    
    .context-close {
      background: none;
      border: none;
      font-size: 18px;
      cursor: pointer;
      color: ${isDarkMode() ? '#aaa' : '#666'} !important;
      padding: 0;
      margin-left: 8px;
    }
    
    /* Context menu content */
    .context-menu-content {
      padding: 12px 16px;
    }
    
    .context-section {
      margin-bottom: 16px;
    }
    
    .context-section:last-child {
      margin-bottom: 0;
    }
    
    .context-fact {
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 8px 0;
      color: ${isDarkMode() ? '#eee' : '#333'} !important;
    }
    
    .context-info {
      font-size: 13px;
      line-height: 1.5;
      margin: 0;
      color: ${isDarkMode() ? '#ccc' : '#666'} !important;
    }
    
    .sources-section {
      border-top: 1px solid ${isDarkMode() ? '#444' : '#eee'};
      padding-top: 12px;
    }
    
    .sources-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .source-link {
      font-size: 13px;
      color: ${isDarkMode() ? '#add8e6' : '#0066cc'} !important;
      text-decoration: none;
      display: block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .source-link:hover {
      text-decoration: underline;
    }
    
    .source-number {
      color: ${isDarkMode() ? '#aaa' : '#666'} !important;
      margin-right: 4px;
    }

    #${CONTAINER_ID} {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 300px;
      height: 400px;
      min-width: ${MIN_SIZE}px;
      min-height: ${MIN_SIZE}px;
      max-width: 80vw;
      max-height: 80vh;
      overflow-y: auto;
      background-color: ${isDarkMode() ? '#333' : 'white'};
      color: ${isDarkMode() ? 'white' : 'black'} !important;
      border: 1px solid #ccc;
      border-radius: 10px;
      padding: 15px;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
      z-index: 9999;
      font-family: 'Satoshi', sans-serif !important;
    }
    #${CONTAINER_ID} * {
      font-family: 'Satoshi', sans-serif !important;
      color: ${isDarkMode() ? 'white' : 'black'} !important;
    }
    #${CONTAINER_ID} .fact-check-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    #${CONTAINER_ID} h2 {
      margin: 0;
      text-align: center;
      width: 100%;
      font-size: 24px;
    }
    #${CONTAINER_ID} h3 {
      text-align: center;
      font-size: 20px;
      margin-top: 0;
      margin-bottom: 25px;
    }
    #${CONTAINER_ID} h4 {
      margin-top: 20px;
      margin-bottom: 10px;
      font-size: 18px;
    }
    #${CONTAINER_ID} p, #${CONTAINER_ID} li {
      font-size: 14px;
      line-height: 1.4;
    }
    #${CONTAINER_ID} a {
      color: ${isDarkMode() ? '#add8e6' : '#0000EE'} !important;
      text-decoration: none;
    }
    #${CONTAINER_ID} a:hover {
      text-decoration: underline;
    }
    #${CLOSE_BTN_ID} {
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: ${isDarkMode() ? 'white' : 'black'} !important;
      position: absolute;
      top: 10px;
      right: 10px;
    }
    #${COPY_BTN_ID} {
      display: block;
      margin-top: 15px;
      padding: 5px 10px;
      background-color: #4CAF50;
      color: white !important;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
    }
    #${COPY_BTN_ID}:hover {
      background-color: #45a049;
    }
    .loader {
      border: 5px solid #f3f3f3;
      border-top: 5px solid #3498db;
      border-radius: 50%;
      width: 50px;
      height: 50px;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
})();
