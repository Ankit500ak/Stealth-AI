// Simple logger for renderer process
const logger = {
    info: (...args) => console.log('[MainWindowUI]', ...args),
    debug: (...args) => console.log('[MainWindowUI DEBUG]', ...args),
    error: (...args) => console.error('[MainWindowUI ERROR]', ...args),
    warn: (...args) => console.warn('[MainWindowUI WARN]', ...args)
};

class MainWindowUI {

    // --- TEXT MODE: Capture screenshot, send to API, and display extracted text ---
    async captureAndShowScreenText() {
        try {
            this.showProcessingIndicator('Extracting text from screen...');
            // Request main process to capture screenshot and process with text skill
            const ocrOptions = { numeric: true, emojiPreserve: true, psm: 6, whitelist: null };
            const result = await (window.electronAPI.takeScreenshot ? window.electronAPI.takeScreenshot({ skill: 'text', ocr: ocrOptions }) : window.electronAPI.invoke && window.electronAPI.invoke('take-screenshot', { skill: 'text', ocr: ocrOptions }));
            // Expect result: { response: string, metadata: object, skill: 'text' }
            this.hideProcessingIndicator();
            if (result && result.response) {
                this.showScreenTextResult(result.response);
            } else {
                this.showScreenTextResult('No text detected or extraction failed.');
            }
        } catch (err) {
            this.hideProcessingIndicator();
            this.showScreenTextResult('Error extracting text: ' + (err?.message || err));
        }
    }

    showScreenTextResult(text) {
        let textBox = document.getElementById('screenTextBox');
        if (!textBox) {
            textBox = document.createElement('div');
            textBox.id = 'screenTextBox';
            textBox.style.width = '90vw';
            textBox.style.margin = '24px auto 0 auto';
            textBox.style.background = '#181818';
            textBox.style.color = '#fff';
            textBox.style.padding = '24px';
            textBox.style.borderRadius = '10px';
            textBox.style.fontSize = '16px';
            textBox.style.boxShadow = '0 4px 24px rgba(0,0,0,0.18)';
            textBox.style.maxHeight = '40vh';
            textBox.style.overflowY = 'auto';
            textBox.style.whiteSpace = 'pre-wrap';
            document.body.insertBefore(textBox, document.body.children[1]);
        }
        textBox.innerHTML = '';
        // Add prompt/label for text mode
        const label = document.createElement('div');
        label.innerText = 'Text Mode: The data below is extracted from your screen (word-for-word, line-by-line):';
        label.style.fontWeight = 'bold';
        label.style.marginBottom = '16px';
        label.style.fontSize = '15px';
        label.style.color = '#a3e635';
        textBox.appendChild(label);
        const textContent = document.createElement('div');
        textContent.innerText = text || 'No visible text found.';
        textBox.appendChild(textContent);
        // Add copy button
        const copyBtn = document.createElement('button');
        copyBtn.innerText = 'Copy Text';
        copyBtn.style.marginTop = '18px';
        copyBtn.style.padding = '8px 24px';
        copyBtn.style.background = '#444';
        copyBtn.style.color = '#fff';
        copyBtn.style.border = 'none';
        copyBtn.style.borderRadius = '6px';
        copyBtn.style.cursor = 'pointer';
        copyBtn.onclick = () => this.copyScreenTextToClipboard(text);
        textBox.appendChild(copyBtn);
        textBox.style.display = 'block';
    }

    constructor() {
        this.isInteractive = false;
        this.isHidden = false;
        this.currentSkill = 'dsa'; // Default, will be updated from settings
        this.statusDot = null;
        this.skillSelector = null;
        this.skillSelect = null;
        this.micButton = null;
        this.isRecording = false;
        this.speechAvailable = false; // track availability
        this._popoverHideTimeout = null;

        // Define available skills for navigation
        this.availableSkills = [
            'dsa',
            'mcq',
            'rephrase',
            'text'
        ];

        this.init();
    }

    async init() {
        try {
            this.setupElements();
            this.setupEventListeners();
            this.setupIPC();

            // Load current skill from settings
            await this.loadCurrentSkill();

            // Load current interaction state
            await this.loadCurrentInteractionState();

            // Fetch speech availability
            await this.loadSpeechAvailability();

            this.updateSkillSelector();
            this.updateAllElementStates(); // Update all elements with current state
            this.resizeWindowToContent();

            logger.info('Main window UI initialized', {
                component: 'MainWindowUI',
                skill: this.currentSkill,
                interactive: this.isInteractive
            });

        } catch (error) {
            logger.error('Failed to initialize main window UI', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    setupIPC() {
        // Listen for messages from the main process for voice processing feedback
        if (window.electronAPI && window.electronAPI.onMainMessage) {
            window.electronAPI.onMainMessage((event, data) => {
                switch (event) {
                    case 'voice-question-processing':
                        this.handleVoiceQuestionProcessing(data);
                        break;
                    case 'voice-answer-ready':
                        this.handleVoiceAnswerReady(data);
                        break;
                    case 'web-speech-started':
                        this.handleWebSpeechStarted();
                        break;
                    case 'web-speech-stopped':
                        this.handleWebSpeechStopped();
                        break;
                    case 'web-speech-final':
                        this.handleWebSpeechFinal(data);
                        break;
                    case 'web-speech-interim':
                        this.handleWebSpeechInterim(data);
                        break;
                    case 'web-speech-error':
                        this.handleWebSpeechError(data);
                        break;
                }
            });
        }
    }

    handleVoiceQuestionProcessing(data) {
        logger.info('🚀 Voice question processing started', data);
        this.showProcessingIndicator(data.text);
    }

    handleVoiceAnswerReady(data) {
        logger.info('✅ Voice answer ready', data);
        this.hideProcessingIndicator();
        this.showAnswerReady();
    }

    handleWebSpeechStarted() {
        logger.info('🎤 Web Speech started');
        this.isRecording = true;
        this.updateMicButtonState();
    }

    handleWebSpeechStopped() {
        logger.info('🔇 Web Speech stopped');
        this.isRecording = false;
        this.updateMicButtonState();
    }

    handleWebSpeechFinal(data) {
        logger.info('📝 Web Speech final result:', data.text);
        // Could show final transcription in UI
    }

    handleWebSpeechInterim(data) {
        logger.debug('💭 Web Speech interim result:', data.text);
        // Could show live transcription in UI
    }

    handleWebSpeechError(data) {
        logger.error('❌ Web Speech error:', data.error);
        this.isRecording = false;
        this.updateMicButtonState();
        this.showNotification(`Speech error: ${data.error}`, 'error');
    }

    showProcessingIndicator(questionText) {
        // Add blinking effect to show processing
        if (this.micButton) {
            this.micButton.classList.add('processing');
        }

        // Show processing notification
        this.showNotification(`🤖 AI analyzing: "${questionText.substring(0, 30)}..."`, 'info');
    }

    hideProcessingIndicator() {
        // Remove processing effect
        if (this.micButton) {
            this.micButton.classList.remove('processing');
        }
    }

    showAnswerReady() {
        // Show success notification
        this.showNotification('✅ Answer ready! Check results window.', 'success');

        // Brief flash effect
        if (this.micButton) {
            this.micButton.classList.add('success-flash');
            setTimeout(() => {
                this.micButton.classList.remove('success-flash');
            }, 1000);
        }
    }



    async loadCurrentSkill() {
        try {
            if (window.electronAPI && window.electronAPI.getSettings) {
                const settings = await window.electronAPI.getSettings();
                if (settings && settings.activeSkill) {
                    this.currentSkill = settings.activeSkill;
                    logger.debug('Loaded current skill from settings', {
                        component: 'MainWindowUI',
                        skill: this.currentSkill
                    });
                }
            }
        } catch (error) {
            logger.warn('Failed to load current skill from settings', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    async loadCurrentInteractionState() {
        try {
            // Request current interaction state from main process
            if (window.electronAPI && window.electronAPI.getWindowStats) {
                const stats = await window.electronAPI.getWindowStats();
                if (stats && typeof stats.isInteractive === 'boolean') {
                    this.isInteractive = stats.isInteractive;
                    logger.debug('Loaded current interaction state', {
                        component: 'MainWindowUI',
                        interactive: this.isInteractive
                    });
                }
            }
        } catch (error) {
            // If we can't get the state, assume non-interactive (safer default)
            this.isInteractive = false;
            logger.warn('Failed to load current interaction state, defaulting to non-interactive', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    async loadSpeechAvailability() {
        try {
            if (window.electronAPI && window.electronAPI.getSpeechAvailability) {
                this.speechAvailable = await window.electronAPI.getSpeechAvailability();
                this.applyMicVisibility();
            }
        } catch (e) {
            this.speechAvailable = false;
            this.applyMicVisibility();
        }
    }

    applyMicVisibility() {
        if (this.micButton) {
            // Always show microphone button, but indicate availability through styling
            this.micButton.style.display = '';

            if (this.speechAvailable) {
                this.micButton.style.opacity = '1';
                this.micButton.title = '🎤 Voice recognition ready! Click to ask questions';
                this.micButton.classList.remove('speech-disabled');
            } else {
                this.micButton.style.opacity = '0.5';
                this.micButton.title = '🎤 Speech recognition loading... Please wait';
                this.micButton.classList.add('speech-disabled');
            }
            // Resize to reflect layout change
            setTimeout(() => this.resizeWindowToContent(), 50);
        }
    }

    updateAllElementStates() {
        // Update all interactive elements with current state
        this.updateStatusDot();
        this.updateSkillSelectorState();
        this.updateMicButtonState();
        this.updateSettingsIndicatorState();
    }

    updateStatusDot() {
        if (this.statusDot) {
            logger.debug('Updating status dot', {
                component: 'MainWindowUI',
                isInteractive: this.isInteractive,
                currentClasses: this.statusDot.className
            });

            // Remove both classes first
            this.statusDot.classList.remove('interactive', 'non-interactive');

            // Add the appropriate class
            if (this.isInteractive) {
                this.statusDot.classList.add('interactive');
            } else {
                this.statusDot.classList.add('non-interactive');
            }

            logger.debug('Status dot updated', {
                component: 'MainWindowUI',
                interactive: this.isInteractive,
                newClasses: this.statusDot.className
            });
        } else {
            logger.error('Status dot element not found');
        }
    }

    updateSkillSelectorState() {
        if (this.skillSelector) {
            // Remove both classes first
            this.skillSelector.classList.remove('interactive', 'non-interactive');

            // Add the appropriate class
            if (this.isInteractive) {
                this.skillSelector.classList.add('interactive');
            } else {
                this.skillSelector.classList.add('non-interactive');
            }

            logger.debug('Skill selector state updated', {
                component: 'MainWindowUI',
                interactive: this.isInteractive,
                classes: this.skillSelector.className
            });
        }
    }



    updateMicButtonState() {
        if (this.micButton) {
            // Also hide when unavailable
            this.applyMicVisibility();
            // Remove both classes first
            this.micButton.classList.remove('interactive', 'non-interactive');

            // Add the appropriate class
            if (this.isInteractive) {
                this.micButton.classList.add('interactive');
            } else {
                this.micButton.classList.add('non-interactive');
            }

            // Update button state
            this.micButton.disabled = !this.isInteractive;

            logger.debug('Mic button state updated', {
                component: 'MainWindowUI',
                interactive: this.isInteractive,
                disabled: !this.isInteractive
            });
        }
    }

    updateSettingsIndicatorState() {
        if (this.settingsIndicator) {
            // Remove both classes first
            this.settingsIndicator.classList.remove('interactive', 'non-interactive');

            // Add the appropriate class
            if (this.isInteractive) {
                this.settingsIndicator.classList.add('interactive');
            } else {
                this.settingsIndicator.classList.add('non-interactive');
            }

            logger.debug('Settings indicator state updated', {
                component: 'MainWindowUI',
                interactive: this.isInteractive
            });
        } else {
            logger.debug('Settings indicator not found, skipping state update');
        }
    }

    resizeWindowToContent() {
        // Wait for DOM to fully render
        setTimeout(() => {
            const commandTab = document.querySelector('.command-tab');
            if (commandTab && window.electronAPI && window.electronAPI.resizeWindow) {
                const rect = commandTab.getBoundingClientRect();
                const width = Math.ceil(rect.width);
                let height = Math.ceil(rect.height);

                // If shortcuts popover is visible, extend height to fit it
                if (this.shortcutsPopover && this.shortcutsPopover.classList.contains('is-open')) {
                    const popRect = this.shortcutsPopover.getBoundingClientRect();
                    // popover is positioned below the bar (top:36px), add that plus its height and a small margin
                    height = Math.max(height, Math.ceil(36 + popRect.height + 8));
                }

                logger.debug('Resizing window to content', {
                    width,
                    height,
                    component: 'MainWindowUI'
                });

                window.electronAPI.resizeWindow(width, height);
            }
        }, 100);
    }

    setupElements() {

        this.statusDot = document.getElementById('statusDot');
        this.skillSelector = document.getElementById('skillSelector');
        this.skillSelect = document.getElementById('skillSelect');
        this.settingsIndicator = document.getElementById('settingsIndicator'); // Optional
        this.micButton = document.getElementById('micButton');
        this.infoButton = document.getElementById('infoButton');
        this.shortcutsPopover = document.getElementById('shortcutsPopover');
        this.screenshotButton = document.querySelector('.command-item i.fas.fa-camera')?.parentElement;
        // this.readButton = document.getElementById('readButton');

        if (!this.statusDot || !this.skillSelector || !this.skillSelect || !this.micButton || !this.screenshotButton) {
            throw new Error('Required UI elements not found');
        }

        // Screenshot click handler
        this.screenshotButton.addEventListener('click', () => {
            if (this.isInteractive && window.electronAPI && window.electronAPI.takeScreenshot) {
                window.electronAPI.takeScreenshot();
            }
        });

        // Read button click handler (pure OCR, no AI/DSA logic)
        this.readButton.addEventListener('click', () => {
            if (!this.isInteractive) return;
            this.readScreenAndShowText();
        });

        // Skill selector change handler
        this.skillSelect.addEventListener('change', (event) => {
            if (!this.isInteractive) return;
            const newSkill = event.target.value;
            // --- TEXT MODE: Capture screenshot, send to API, and display extracted text ---
            if (newSkill === 'text') {
                this.captureAndShowScreenText();
                return; // Do not trigger any AI or DSA logic
            }
            // For all other skills, hide the text box and proceed as normal
            this.hideScreenTextBox();
            if (window.electronAPI && window.electronAPI.updateActiveSkill) {
                window.electronAPI.updateActiveSkill(newSkill).then(() => {
                    this.handleSkillActivated(newSkill);
                });
            } else {
                this.handleSkillActivated(newSkill);
            }

            // --- TEXT MODE: Capture screenshot, send to API, and display extracted text ---

        });

        // Check for required elements (settingsIndicator is optional)
        if (this.settingsIndicator) {
            this.settingsIndicator.addEventListener('click', () => {
                if (this.isInteractive) {
                    this.showSettingsMenu();
                }
            });
        }

        // Add click handler for microphone
        this.micButton.addEventListener('click', () => {
            if (!this.isInteractive) {
                return; // Don't do anything if not interactive
            }

            // Speech is available, toggle recording
            if (this.isRecording) {
                window.electronAPI.stopSpeechRecognition();
            } else {
                window.electronAPI.startSpeechRecognition();
            }
        });

        // Language dropdown
        this.languageSelect = document.getElementById('codingLanguage');
        if (this.languageSelect) {
            // Set default to C++ if no value is set
            this.languageSelect.value = 'cpp';

            // Initialize with current setting
            if (window.electronAPI && window.electronAPI.getSettings) {
                window.electronAPI.getSettings().then(settings => {
                    if (settings && settings.codingLanguage) {
                        this.languageSelect.value = settings.codingLanguage;
                    } else {
                        // Save C++ as default if no language is set
                        this.languageSelect.value = 'cpp';
                        window.electronAPI.saveSettings({ codingLanguage: 'cpp' });
                    }
                }).catch(() => {
                    // Fallback to C++ on error
                    this.languageSelect.value = 'cpp';
                });
            }

            this.languageSelect.addEventListener('change', (e) => {
                const lang = e.target.value;
                if (window.electronAPI && window.electronAPI.saveSettings) {
                    window.electronAPI.saveSettings({ codingLanguage: lang });
                }
                // Resize for any width change
                setTimeout(() => {
                    const commandTab = document.querySelector('.command-tab');
                    if (commandTab && window.electronAPI && window.electronAPI.resizeWindow) {
                        const rect = commandTab.getBoundingClientRect();
                        window.electronAPI.resizeWindow(Math.ceil(rect.width), Math.ceil(rect.height));
                    }
                }, 50);
            });
        }

        // Info button / shortcuts popover
        if (this.infoButton && this.shortcutsPopover) {
            this.infoButton.addEventListener('click', (e) => {
                if (!this.isInteractive) return;
                e.stopPropagation();
                this.toggleShortcutsPopover();
            });

            // Hover to show
            this.infoButton.addEventListener('mouseenter', () => {
                if (!this.isInteractive) return;
                this.showShortcutsPopover();
            });
            // Queue hide when leaving the button
            this.infoButton.addEventListener('mouseleave', () => this.queueHideShortcutsPopover());

            // Keep open when hovering popover
            this.shortcutsPopover.addEventListener('mouseenter', () => {
                if (this._popoverHideTimeout) {
                    clearTimeout(this._popoverHideTimeout);
                    this._popoverHideTimeout = null;
                }
            });
            // Hide after a small delay when leaving popover
            this.shortcutsPopover.addEventListener('mouseleave', () => this.queueHideShortcutsPopover());

            // Close on outside click
            document.addEventListener('click', (e) => {
                if (!this.shortcutsPopover) return;
                const isClickInside = this.shortcutsPopover.contains(e.target) || this.infoButton.contains(e.target);
                if (!isClickInside && this.shortcutsPopover.classList.contains('is-open')) {
                    this.hideShortcutsPopover();
                }
            });

            // Close on Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.shortcutsPopover && this.shortcutsPopover.classList.contains('is-open')) {
                    this.hideShortcutsPopover();
                }
            });
        }
    }

    setupEventListeners() {
        if (window.electronAPI) {
            // Fix interaction mode change listener
            window.electronAPI.onInteractionModeChanged((event, interactive) => {
                logger.debug('Interaction mode changed received:', interactive);
                this.handleInteractionModeChanged(interactive);
            });

            window.electronAPI.onRecordingStarted(() => {
                this.handleRecordingStarted();
            });

            window.electronAPI.onRecordingStopped(() => {
                this.handleRecordingStopped();
            });

            window.electronAPI.onSkillChanged((event, data) => {
                if (data && data.skill) {
                    this.handleSkillChanged(data);
                }
            });

            window.electronAPI.onSpeechAvailability((event, data) => {
                this.speechAvailable = !!(data && data.available);
                this.applyMicVisibility();
            });

            // Listen for coding language changes from other windows
            window.electronAPI.onCodingLanguageChanged((event, data) => {
                if (data && data.language && this.languageSelect) {
                    // avoid clobbering if same value
                    if (this.languageSelect.value !== data.language) {
                        this.languageSelect.value = data.language;
                    }
                    logger.debug('Language updated from other window', {
                        component: 'MainWindowUI',
                        language: data.language
                    });
                }
            });

            // Global keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                if (e.altKey && e.key === 'r' && this.isInteractive) {
                    e.preventDefault();
                    if (!this.speechAvailable) return; // guard when unavailable
                    if (this.isRecording) {
                        window.electronAPI.stopSpeechRecognition();
                    } else {
                        window.electronAPI.startSpeechRecognition();
                    }
                }
            });
        }

        // Also listen via the api interface for backup
        if (window.api) {

            window.api.receive('interaction-mode-changed', (interactive) => {
                logger.debug('Interaction mode changed via api:', interactive);
                this.handleInteractionModeChanged(interactive);
            });

            window.api.receive('skill-updated', (data) => {
                logger.info('Skill updated event received from main process:', data);
                if (data && data.skill) {
                    this.handleSkillChanged(data);
                } else if (typeof data === 'string') {
                    // Handle case where skill is passed directly as string
                    this.handleSkillChanged({ skill: data });
                } else {
                    logger.warn('Skill updated event received but no skill data found:', data);
                }
            });

            // Listen for skill updates from settings window  
            window.api.receive('update-skill', (skill) => {
                logger.info('Direct skill update received from settings:', skill);
                this.handleSkillChanged({ skill: skill });
            });
        } else {
            logger.error('window.api not available - event listeners not set up!');
        }

        // Keyboard shortcuts
        this.setupKeyboardShortcuts();

        // Settings shortcut
        this.setupSettingsShortcut();
    }

    handleLLMResponse(data) {
        const skill = data.skill || data.metadata?.skill || 'General';
        const skillNames = {
            'dsa': 'DSA',
            'behavioral': 'Behavioral',
            'sales': 'Sales',
            'presentation': 'Presentation',
            'data-science': 'Data Science',
            'programming': 'Programming',
            'devops': 'DevOps',
            'system-design': 'System Design',
            'negotiation': 'Negotiation'
        };

        const displaySkill = skillNames[skill] || skill.toUpperCase();

        logger.info('LLM response received', {
            component: 'MainWindowUI',
            skill: skill,
            displaySkill: displaySkill
        });
    }

    handleLLMError(data) {
        logger.error('LLM error received', {
            component: 'MainWindowUI',
            error: data.error
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.metaKey && e.key === '\\') {
                this.isHidden = !this.isHidden;
                if (this.isHidden) {
                    this.showHiddenIndicator();
                }
            }

            // Handle Cmd + Arrow keys based on interaction mode
            if (e.metaKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();

                if (this.isInteractive) {
                    // Interactive mode: Cmd + Up/Down for skill navigation
                    if (e.key === 'ArrowUp') {
                        this.navigateSkill(-1); // Previous skill
                    } else if (e.key === 'ArrowDown') {
                        this.navigateSkill(1); // Next skill
                    } else {
                    }
                    // Left/Right arrows do nothing in interactive mode
                } else {
                    // Non-interactive mode: Cmd + Arrow keys for window movement
                    this.moveWindow(e.key);
                }
            }

            // Alt+A is handled globally by the main process
            // No need to handle it here since it needs to work even when windows are non-interactive
        });
    }

    handleInteractionModeChanged(interactive) {
        logger.info('Handling interaction mode change', {
            component: 'MainWindowUI',
            newState: interactive,
            previousState: this.isInteractive
        });

        // Update the internal state
        this.isInteractive = interactive;

        // Update all UI elements to reflect the new state
        this.updateAllElementStates();

        // Auto-hide popover when leaving interactive mode
        if (!this.isInteractive && this.shortcutsPopover && this.shortcutsPopover.style.display !== 'none') {
            this.hideShortcutsPopover();
        }

        // Update skill selector tooltip
        this.updateSkillSelector();

        logger.info('Interaction mode change completed', {
            component: 'MainWindowUI',
            interactive: this.isInteractive,
            statusDotClass: this.statusDot ? this.statusDot.className : 'not found',
            skillSelectorClass: this.skillSelector ? this.skillSelector.className : 'not found'
        });
    }

    handleSkillChanged(data) {
        const oldSkill = this.currentSkill;
        this.currentSkill = data.skill;

        logger.info('Handling skill change', {
            component: 'MainWindowUI',
            oldSkill: oldSkill,
            newSkill: data.skill,
            skillSelectorExists: !!this.skillSelector
        });

        this.updateSkillSelector();

        logger.info('Skill changed successfully', {
            component: 'MainWindowUI',
            skill: data.skill
        });
    }

    handleSkillActivated(skillName) {
        this.currentSkill = skillName;
        this.updateSkillSelector();

        logger.info('Skill activated', {
            component: 'MainWindowUI',
            skill: skillName
        });
    }



    handleScreenshotRequest() {
        logger.debug('Screenshot request received', { component: 'MainWindowUI' });
    }

    handleRecordingStarted() {
        this.isRecording = true;
        if (this.micButton) {
            this.micButton.classList.add('recording');
            this.micButton.title = '🔴 LISTENING... Click to stop or just start speaking!';
        }

        // Show listening indicator
        this.showListeningIndicator();

        logger.debug('🎤 Voice recording started - ready for questions!', { component: 'MainWindowUI' });
    }

    handleRecordingStopped() {
        this.isRecording = false;
        if (this.micButton) {
            this.micButton.classList.remove('recording');
            this.micButton.title = '🎤 Voice recognition ready! Click to start listening for questions';
        }

        // Hide listening indicator
        this.hideListeningIndicator();

        logger.debug('🔇 Voice recording stopped', { component: 'MainWindowUI' });
    }

    showListeningIndicator() {
        // Create or update listening indicator
        let indicator = document.getElementById('listeningIndicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'listeningIndicator';
            indicator.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: linear-gradient(135deg, rgba(76, 175, 80, 0.9) 0%, rgba(56, 142, 60, 0.95) 100%);
                backdrop-filter: blur(10px);
                color: white;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 11px;
                font-weight: 600;
                z-index: 10000;
                border: 1px solid rgba(255, 255, 255, 0.3);
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
                animation: pulse 2s infinite;
            `;
            document.body.appendChild(indicator);
        }

        indicator.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 8px; height: 8px; background: #ff4757; border-radius: 50%; animation: blink 1s infinite;"></div>
                <span>🎤 Listening for your question...</span>
            </div>
        `;
        indicator.style.display = 'block';
    }

    hideListeningIndicator() {
        const indicator = document.getElementById('listeningIndicator');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }

    updateSkillSelector() {
        const skillNames = {
            'dsa': 'DSA',
            'mcq': 'MCQ',
            'behavioral': 'Behavioral',
            'sales': 'Sales',
            'presentation': 'Presentation',
            'data-science': 'Data Science',
            'programming': 'Programming',
            'devops': 'DevOps',
            'system-design': 'System Design',
            'negotiation': 'Negotiation'
        };

        logger.info('Updating skill selector', {
            component: 'MainWindowUI',
            currentSkill: this.currentSkill,
            skillSelectorExists: !!this.skillSelector,
            skillSelectExists: !!this.skillSelect
        });

        if (!this.skillSelect) {
            logger.error('Skill select element not found!');
            return;
        }

        // Update the selected value in the dropdown
        if (this.skillSelect.value !== this.currentSkill) {
            this.skillSelect.value = this.currentSkill;
            // Force UI update in case browser doesn't reflect change
            this.skillSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        logger.info('[updateSkillSelector] Set dropdown to:', this.currentSkill, 'Dropdown value:', this.skillSelect.value);
        // Enable/disable coding language selector based on skill
        this.updateCodingLanguageSelector();
        logger.info('Skill selector updated successfully', {
            component: 'MainWindowUI',
            selectedSkill: this.currentSkill,
            selectorValue: this.skillSelect.value
        });
        // Add visual feedback for skill change
        this.animateSkillChange();
    }

    updateCodingLanguageSelector() {
        // Skills that require programming language selection
        const skillsRequiringLanguage = ['dsa'];
        const requiresLanguage = skillsRequiringLanguage.includes(this.currentSkill);

        if (this.codingLanguageSelect) {
            const languageSelector = document.getElementById('languageSelector');
            if (languageSelector) {
                if (requiresLanguage) {
                    languageSelector.style.display = 'flex';
                    this.codingLanguageSelect.disabled = false;
                } else {
                    languageSelector.style.display = 'none';
                    this.codingLanguageSelect.disabled = true;
                }
            }
        }
    }

    animateSkillChange() {
        if (this.skillSelector) {
            this.skillSelector.style.transform = 'scale(1.1)';
            this.skillSelector.style.transition = 'transform 0.2s ease';

            setTimeout(() => {
                this.skillSelector.style.transform = 'scale(1)';
            }, 200);
        }
    }

    navigateSkill(direction) {

        if (!this.isInteractive) {
            return;
        }

        const currentIndex = this.availableSkills.indexOf(this.currentSkill);
        if (currentIndex === -1) {
            logger.error('Current skill not found in available skills array');
            return;
        }

        // Calculate new index with wrapping
        let newIndex = currentIndex + direction;
        if (newIndex >= this.availableSkills.length) {
            newIndex = 0; // Wrap to beginning
        } else if (newIndex < 0) {
            newIndex = this.availableSkills.length - 1; // Wrap to end
        }

        const newSkill = this.availableSkills[newIndex];

        // Update skill locally and notify main process
        this.currentSkill = newSkill;
        this.updateSkillSelector();

        // Save the skill change via IPC
        if (window.electronAPI && window.electronAPI.updateActiveSkill) {
            window.electronAPI.updateActiveSkill(newSkill).then(() => {
                logger.info('Skill navigation completed', {
                    component: 'MainWindowUI',
                    newSkill,
                    direction: direction > 0 ? 'down' : 'up'
                });
            }).catch(error => {
                logger.error('Failed to update skill via navigation', {
                    component: 'MainWindowUI',
                    error: error.message
                });
            });
        }

        // Show visual feedback
        this.showSkillChangeNotification(newSkill, direction);
    }

    showSkillChangeNotification(skill, direction) {
        const skillNames = {
            'dsa': 'DSA',
            'behavioral': 'Behavioral',
            'sales': 'Sales',
            'presentation': 'Presentation',
            'data-science': 'Data Science',
            'programming': 'Programming',
            'devops': 'DevOps',
            'system-design': 'System Design',
            'negotiation': 'Negotiation'
        };

        const displayName = skillNames[skill] || skill.toUpperCase();
        const arrow = direction > 0 ? '↓' : '↑';

        // Create temporary notification
        const notification = document.createElement('div');
        notification.className = 'skill-change-notification';
        notification.innerHTML = `${arrow} ${displayName}`;
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.2s ease;
        `;

        document.body.appendChild(notification);

        // Animate in
        setTimeout(() => {
            notification.style.opacity = '1';
        }, 10);

        // Remove after 1 second
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 200);
        }, 1000);
    }

    showHiddenIndicator() {
        const indicator = document.querySelector('.hidden-indicator');
        if (indicator) {
            indicator.classList.add('show');
            setTimeout(() => {
                indicator.classList.remove('show');
            }, 3000);
        }
    }

    toggleInteractiveMode() {
        this.isInteractive = !this.isInteractive;
        this.updateAllElementStates();

        logger.debug('Interactive mode toggled', {
            component: 'MainWindowUI',
            interactive: this.isInteractive
        });
    }

    moveWindow(direction) {
        const moveDistance = 20; // pixels

        if (window.electronAPI && window.electronAPI.moveWindow) {
            let deltaX = 0, deltaY = 0;

            switch (direction) {
                case 'ArrowUp':
                    deltaY = -moveDistance;
                    break;
                case 'ArrowDown':
                    deltaY = moveDistance;
                    break;
                case 'ArrowLeft':
                    deltaX = -moveDistance;
                    break;
                case 'ArrowRight':
                    deltaX = moveDistance;
                    break;
            }

            window.electronAPI.moveWindow(deltaX, deltaY);
            logger.debug('Moving window', {
                component: 'MainWindowUI',
                direction: direction,
                deltaX: deltaX,
                deltaY: deltaY,
                interactive: this.isInteractive
            });
        } else {
            logger.warn('moveWindow API not available', { component: 'MainWindowUI' });
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 p-4 rounded-lg text-white z-50 ${type === 'error' ? 'bg-red-600' :
            type === 'success' ? 'bg-green-600' :
                'bg-blue-600'
            }`;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);

        logger.debug('Notification shown', {
            component: 'MainWindowUI',
            message,
            type
        });
    }

    showSpeechUnavailableNotification() {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 50px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, rgba(255, 152, 0, 0.9) 0%, rgba(255, 193, 7, 0.95) 100%);
            backdrop-filter: blur(10px);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            z-index: 10000;
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
        `;
        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-microphone" style="font-size: 14px;"></i>
                <span>🎤 Voice recognition is loading...</span>
            </div>
            <div style="font-size: 10px; opacity: 0.9; margin-top: 4px;">
                Web Speech API is initializing. Please try again in a moment.
            </div>
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 4000);

        logger.debug('Speech unavailable notification shown', {
            component: 'MainWindowUI'
        });
    }

    async showGeminiConfig() {
        try {
            const status = await window.electronAPI.getGeminiStatus();

            const modal = this.createGeminiConfigModal(status);
            document.body.appendChild(modal);

            logger.debug('Gemini config modal shown', { component: 'MainWindowUI' });
        } catch (error) {
            logger.error('Failed to show Gemini config', {
                component: 'MainWindowUI',
                error: error.message
            });
            this.showNotification('Failed to load Gemini configuration', 'error');
        }
    }

    createGeminiConfigModal(status) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50';
        modal.innerHTML = `
            <div class="bg-gray-900 text-white p-6 rounded-lg max-w-md w-full">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-bold">🤖 Gemini Flash 1.5 Configuration</h2>
                    <button class="text-gray-400 hover:text-white" onclick="this.closest('.fixed').remove()">✕</button>
                </div>
                
                <div class="mb-4 p-3 rounded ${status.hasApiKey ? 'bg-green-900' : 'bg-red-900'}">
                    <p><strong>Status:</strong> ${status.hasApiKey ? 'Configured' : 'Not Configured'}</p>
                    <p><strong>Model:</strong> ${status.model}</p>
                </div>
                
                <div class="mb-4">
                    <label class="block text-sm font-medium mb-2">API Key:</label>
                    <input type="password" id="geminiApiKey" placeholder="Enter your Gemini API key" 
                           class="w-full p-2 bg-gray-800 border border-gray-600 rounded text-white">
                    <p class="text-xs text-gray-400 mt-1">
                        Get your API key from: <a href="https://makersuite.google.com/app/apikey" target="_blank" class="text-blue-400">Google AI Studio</a>
                    </p>
                </div>
                
                <div class="flex space-x-2">
                    <button onclick="mainWindowUI.configureGemini()" class="flex-1 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded">
                        Configure
                    </button>
                    <button onclick="mainWindowUI.testGeminiConnection()" class="flex-1 bg-green-600 hover:bg-green-700 px-4 py-2 rounded">
                        Test Connection
                    </button>
                </div>
                
                <div class="mt-4 text-center">
                    <button class="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded" onclick="this.closest('.fixed').remove()">
                        Close
                    </button>
                </div>
            </div>
        `;
        return modal;
    }

    async configureGemini() {
        const apiKey = document.getElementById('geminiApiKey').value.trim();
        if (!apiKey) {
            this.showNotification('Please enter an API key', 'error');
            return;
        }

        try {
            const result = await window.electronAPI.setGeminiApiKey(apiKey);
            if (result.success) {
                this.showNotification('Gemini API key configured successfully!', 'success');
                document.querySelector('.fixed').remove();

                logger.info('Gemini API key configured', { component: 'MainWindowUI' });
            } else {
                this.showNotification(`Configuration failed: ${result.error}`, 'error');
                logger.error('Gemini configuration failed', {
                    component: 'MainWindowUI',
                    error: result.error
                });
            }
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
            logger.error('Gemini configuration error', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    async testGeminiConnection() {
        try {
            const result = await window.electronAPI.testGeminiConnection();
            if (result.success) {
                this.showNotification('Gemini connection test successful!', 'success');
                logger.info('Gemini connection test successful', { component: 'MainWindowUI' });
            } else {
                this.showNotification(`Connection test failed: ${result.error}`, 'error');
                logger.error('Gemini connection test failed', {
                    component: 'MainWindowUI',
                    error: result.error
                });
            }
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
            logger.error('Gemini connection test error', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    setupSettingsShortcut() {
        document.addEventListener('keydown', (e) => {
            // Cmd+, or Ctrl+, for settings
            if ((e.metaKey || e.ctrlKey) && e.key === ',') {
                logger.debug('Settings keyboard shortcut pressed');
                e.preventDefault();
                this.openSettings();
            }
        });
    }

    openSettings() {
        try {
            if (window.electronAPI && window.electronAPI.showSettings) {
                window.electronAPI.showSettings();
            } else {
                logger.error('electronAPI or showSettings not available');
                return;
            }

            // Add visual feedback
            if (this.settingsIndicator) {
                this.settingsIndicator.style.transform = 'scale(1.1)';
                this.settingsIndicator.style.transition = 'transform 0.2s ease';

                setTimeout(() => {
                    this.settingsIndicator.style.transform = 'scale(1)';
                }, 200);
            }

            logger.info('Settings window opened', { component: 'MainWindowUI' });
        } catch (error) {
            logger.error('Failed to open settings', {
                component: 'MainWindowUI',
                error: error.message
            });
            this.showNotification('Failed to open settings', 'error');
        }
    }

    showSettingsMenu() {
        const menu = document.createElement('div');
        menu.className = 'settings-menu';
        menu.style.cssText = `
            position: absolute;
            right: 10px;
            top: 35px;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(20px);
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            padding: 8px 0;
            min-width: 150px;
            z-index: 1000;
        `;

        const settingsOption = this.createMenuItem('Settings', 'fa-cog', () => {
            this.openSettings();
            document.body.removeChild(menu);
        });

    const quitOption = this.createMenuItem('Quit Stealth AI', 'fa-power-off', () => {
            if (window.electronAPI) {
                window.electronAPI.quitApp();
            }
        });

        menu.appendChild(settingsOption);
        menu.appendChild(this.createMenuSeparator());
        menu.appendChild(quitOption);

        // Add click outside listener to close menu
        const closeMenu = (e) => {
            if (!menu.contains(e.target) && !this.settingsIndicator.contains(e.target)) {
                document.body.removeChild(menu);
                document.removeEventListener('click', closeMenu);
            }
        };
        document.addEventListener('click', closeMenu);

        document.body.appendChild(menu);
    }

    createMenuItem(text, iconClass, onClick) {
        const item = document.createElement('div');
        item.style.cssText = `
            padding: 8px 16px;
            color: rgba(255, 255, 255, 0.9);
            font-size: 13px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s ease;
        `;
        item.innerHTML = `<i class="fas ${iconClass}"></i>${text}`;
        item.addEventListener('mouseover', () => {
            item.style.background = 'rgba(255, 255, 255, 0.1)';
        });
        item.addEventListener('mouseout', () => {
            item.style.background = 'transparent';
        });
        item.addEventListener('click', onClick);
        return item;
    }

    createMenuSeparator() {
        const separator = document.createElement('div');
        separator.style.cssText = `
            height: 1px;
            background: rgba(255, 255, 255, 0.1);
            margin: 8px 0;
        `;
        return separator;
    }

    toggleShortcutsPopover() {
        if (!this.shortcutsPopover) return;
        const isOpen = this.shortcutsPopover.classList.contains('is-open');
        if (!isOpen) {
            this.showShortcutsPopover();
        } else {
            this.hideShortcutsPopover();
        }
    }

    showShortcutsPopover() {
        if (!this.shortcutsPopover) return;
        if (this._popoverHideTimeout) {
            clearTimeout(this._popoverHideTimeout);
            this._popoverHideTimeout = null;
        }
        this.shortcutsPopover.classList.add('is-open');
        // Resize main window to fit popover
        setTimeout(() => this.resizeWindowToContent(), 50);
    }

    hideShortcutsPopover() {
        if (!this.shortcutsPopover) return;
        this.shortcutsPopover.classList.remove('is-open');
        // resize back to compact after transition
        setTimeout(() => this.resizeWindowToContent(), 130);
    }

    queueHideShortcutsPopover() {
        if (!this.shortcutsPopover) return;
        if (this._popoverHideTimeout) clearTimeout(this._popoverHideTimeout);
        this._popoverHideTimeout = setTimeout(() => this.hideShortcutsPopover(), 180);
    }



    async copyScreenTextToClipboard(text) {
        if (!text) return;
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(text);
                this.showNotification('Text copied to clipboard!', 'success');
            } catch (err) {
                this.showNotification('Failed to copy text: ' + (err?.message || err), 'error');
            }
        } else {
            this.showNotification('Clipboard API not supported in this environment.', 'error');
        }
    }

    // Initialize when DOM is ready
}

let mainWindowUI;
if (typeof document !== 'undefined') {
    // Add immediate visual indicator that script is loading
    const style = document.createElement('style');
    document.head.appendChild(style);

    document.addEventListener('DOMContentLoaded', () => {

        mainWindowUI = new MainWindowUI();
        // Make it globally accessible for debugging
        window.mainWindowUI = mainWindowUI;
        logger.info('MainWindowUI initialized and available as window.mainWindowUI');
    });
}

// module.exports = MainWindowUI; // Not needed in browser context