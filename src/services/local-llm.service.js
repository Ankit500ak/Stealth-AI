const https = require('https');
const http = require('http');
const logger = require('../core/logger').createServiceLogger('LocalLLM');
const config = require('../core/config');
const { promptLoader } = require('../../prompt-loader');

class LocalLLMService {
  constructor() {
    this.isInitialized = false;
    this.requestCount = 0;
    this.errorCount = 0;
    this.baseUrl = null;
    this.modelName = null;
    this.apiType = null;
    
    this.initializeClient();
  }

  initializeClient() {
    const llmConfig = config.get('llm.local');
    
    if (!llmConfig || !llmConfig.host || !llmConfig.port) {
      logger.warn('Local LLM configuration incomplete', { 
        config: llmConfig,
        required: ['host', 'port', 'model']
      });
      return;
    }

    this.baseUrl = `${llmConfig.protocol || 'http'}://${llmConfig.host}:${llmConfig.port}`;
    this.modelName = llmConfig.model;
    this.apiType = llmConfig.type || 'ollama'; // ollama, localai, openai-compatible
    this.isInitialized = true;
    
    logger.info('Local LLM client initialized successfully', {
      baseUrl: this.baseUrl,
      model: this.modelName,
      apiType: this.apiType
    });
  }

  /**
   * Process an image with the local LLM using the active skill prompt.
   * Note: Image support depends on the local model capabilities
   */
  async processImageWithSkill(imageBuffer, mimeType, activeSkill, sessionMemory = [], programmingLanguage = null) {
    if (!this.isInitialized) {
      throw new Error('Local LLM service not initialized. Check configuration.');
    }

    if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
      throw new Error('Invalid image buffer provided to processImageWithSkill');
    }

    const startTime = Date.now();
    this.requestCount++;

    try {
      // Build system instruction using the skill prompt
      const { promptLoader } = require('../../prompt-loader');
      const skillPrompt = promptLoader.getSkillPrompt(activeSkill, programmingLanguage) || '';

      // Convert image to base64
      const base64Image = imageBuffer.toString('base64');
      const instruction = this.formatImageInstruction(activeSkill, programmingLanguage);

      let responseText;
      
      // Handle different API types
      switch (this.apiType) {
        case 'ollama':
          responseText = await this.executeOllamaImageRequest(instruction, base64Image, mimeType, skillPrompt);
          break;
        case 'localai':
        case 'openai-compatible':
          responseText = await this.executeOpenAICompatibleImageRequest(instruction, base64Image, mimeType, skillPrompt);
          break;
        default:
          throw new Error(`Unsupported API type: ${this.apiType}`);
      }

      // Enforce language in code fences if provided
      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(responseText, programmingLanguage)
        : responseText;

      logger.logPerformance('Local LLM image processing', startTime, {
        activeSkill,
        imageSize: imageBuffer.length,
        responseLength: finalResponse.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          isImageAnalysis: true,
          mimeType,
          apiType: this.apiType
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('Local LLM image processing failed', {
        error: error.message,
        activeSkill,
        requestId: this.requestCount
      });

      if (config.get('llm.local.fallbackEnabled')) {
        return this.generateFallbackResponse('[image]', activeSkill);
      }
      throw error;
    }
  }

  formatImageInstruction(activeSkill, programmingLanguage) {
    const langNote = programmingLanguage ? ` Use only ${programmingLanguage.toUpperCase()} for any code.` : '';
    return `Analyze this image for a ${activeSkill.toUpperCase()} question. Extract the problem concisely and provide the best possible solution with explanation and final code.${langNote}`;
  }

  async processTextWithSkill(text, activeSkill, sessionMemory = [], programmingLanguage = null) {
    if (!this.isInitialized) {
      throw new Error('Local LLM service not initialized. Check configuration.');
    }

    const startTime = Date.now();
    this.requestCount++;
    
    try {
      logger.info('Processing text with Local LLM', {
        activeSkill,
        textLength: text.length,
        hasSessionMemory: sessionMemory.length > 0,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      let response;
      
      // Handle different API types
      switch (this.apiType) {
        case 'ollama':
          response = await this.executeOllamaTextRequest(text, activeSkill, sessionMemory, programmingLanguage);
          break;
        case 'localai':
        case 'openai-compatible':
          response = await this.executeOpenAICompatibleTextRequest(text, activeSkill, sessionMemory, programmingLanguage);
          break;
        default:
          throw new Error(`Unsupported API type: ${this.apiType}`);
      }
      
      // Enforce language in code fences if programmingLanguage specified
      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(response, programmingLanguage)
        : response;

      logger.logPerformance('Local LLM text processing', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          apiType: this.apiType
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('Local LLM processing failed', {
        error: error.message,
        activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      if (config.get('llm.local.fallbackEnabled')) {
        return this.generateFallbackResponse(text, activeSkill);
      }
      
      throw error;
    }
  }

  async processTranscriptionWithIntelligentResponse(text, activeSkill, sessionMemory = [], programmingLanguage = null) {
    if (!this.isInitialized) {
      throw new Error('Local LLM service not initialized. Check configuration.');
    }

    const startTime = Date.now();
    this.requestCount++;
    
    try {
      logger.info('Processing transcription with intelligent response', {
        activeSkill,
        textLength: text.length,
        hasSessionMemory: sessionMemory.length > 0,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      let response;
      
      // Handle different API types with intelligent transcription
      switch (this.apiType) {
        case 'ollama':
          response = await this.executeOllamaTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage);
          break;
        case 'localai':
        case 'openai-compatible':
          response = await this.executeOpenAICompatibleTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage);
          break;
        default:
          throw new Error(`Unsupported API type: ${this.apiType}`);
      }
      
      // Enforce language in code fences if programmingLanguage specified
      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(response, programmingLanguage)
        : response;

      logger.logPerformance('Local LLM transcription processing', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          isTranscriptionResponse: true,
          apiType: this.apiType
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('Local LLM transcription processing failed', {
        error: error.message,
        activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      if (config.get('llm.local.fallbackEnabled')) {
        return this.generateIntelligentFallbackResponse(text, activeSkill);
      }
      
      throw error;
    }
  }

  // Ollama API implementations
  async executeOllamaTextRequest(text, activeSkill, sessionMemory, programmingLanguage) {
    const skillPrompt = this.getSkillPrompt(activeSkill, programmingLanguage);
    const messages = this.buildConversationHistory(text, activeSkill, sessionMemory, skillPrompt);
    
    const requestBody = {
      model: this.modelName,
      messages: messages,
      stream: false,
      options: {
        temperature: 0.7,
        num_predict: 2048,
        top_k: 40,
        top_p: 0.95
      }
    };

    const response = await this.makeHttpRequest(`${this.baseUrl}/api/chat`, 'POST', requestBody);
    return response.message?.content || response.response || '';
  }

  async executeOllamaImageRequest(instruction, base64Image, mimeType, skillPrompt) {
    const requestBody = {
      model: this.modelName,
      prompt: `${skillPrompt}\n\n${instruction}`,
      images: [base64Image],
      stream: false,
      options: {
        temperature: 0.7,
        num_predict: 2048
      }
    };

    const response = await this.makeHttpRequest(`${this.baseUrl}/api/generate`, 'POST', requestBody);
    return response.response || '';
  }

  async executeOllamaTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage) {
    const intelligentPrompt = this.getIntelligentTranscriptionPrompt(activeSkill, programmingLanguage);
    const messages = this.buildConversationHistory(text, activeSkill, sessionMemory, intelligentPrompt);
    
    const requestBody = {
      model: this.modelName,
      messages: messages,
      stream: false,
      options: {
        temperature: 0.7,
        num_predict: 2048
      }
    };

    const response = await this.makeHttpRequest(`${this.baseUrl}/api/chat`, 'POST', requestBody);
    return response.message?.content || response.response || '';
  }

  // OpenAI-compatible API implementations
  async executeOpenAICompatibleTextRequest(text, activeSkill, sessionMemory, programmingLanguage) {
    const skillPrompt = this.getSkillPrompt(activeSkill, programmingLanguage);
    const messages = this.buildConversationHistory(text, activeSkill, sessionMemory, skillPrompt);
    
    const requestBody = {
      model: this.modelName,
      messages: messages,
      temperature: 0.7,
      max_tokens: 2048,
      top_p: 0.95
    };

    const response = await this.makeHttpRequest(`${this.baseUrl}/v1/chat/completions`, 'POST', requestBody);
    return response.choices?.[0]?.message?.content || '';
  }

  async executeOpenAICompatibleImageRequest(instruction, base64Image, mimeType, skillPrompt) {
    const messages = [
      {
        role: 'system',
        content: skillPrompt
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          { 
            type: 'image_url', 
            image_url: { 
              url: `data:${mimeType};base64,${base64Image}` 
            } 
          }
        ]
      }
    ];
    
    const requestBody = {
      model: this.modelName,
      messages: messages,
      temperature: 0.7,
      max_tokens: 2048
    };

    const response = await this.makeHttpRequest(`${this.baseUrl}/v1/chat/completions`, 'POST', requestBody);
    return response.choices?.[0]?.message?.content || '';
  }

  async executeOpenAICompatibleTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage) {
    const intelligentPrompt = this.getIntelligentTranscriptionPrompt(activeSkill, programmingLanguage);
    const messages = this.buildConversationHistory(text, activeSkill, sessionMemory, intelligentPrompt);
    
    const requestBody = {
      model: this.modelName,
      messages: messages,
      temperature: 0.7,
      max_tokens: 2048
    };

    const response = await this.makeHttpRequest(`${this.baseUrl}/v1/chat/completions`, 'POST', requestBody);
    return response.choices?.[0]?.message?.content || '';
  }

  // Utility methods
  buildConversationHistory(text, activeSkill, sessionMemory, systemPrompt) {
    const messages = [];
    
    // Add system prompt if available
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt
      });
    }

    // Check for new session manager format
    const sessionManager = require('../managers/session.manager');
    
    if (sessionManager && typeof sessionManager.getConversationHistory === 'function') {
      const conversationHistory = sessionManager.getConversationHistory(15);
      
      // Add conversation history (excluding system messages)
      const conversationContents = conversationHistory
        .filter(event => {
          return event.role !== 'system' && 
                 event.content && 
                 typeof event.content === 'string' && 
                 event.content.trim().length > 0;
        })
        .map(event => ({
          role: event.role === 'model' ? 'assistant' : 'user',
          content: event.content.trim()
        }));

      messages.push(...conversationContents);
    } else {
      // Fallback to old session memory format
      sessionMemory.forEach(item => {
        if (item.role && item.content) {
          messages.push({
            role: item.role === 'model' ? 'assistant' : 'user',
            content: item.content
          });
        }
      });
    }

    // Add current user message
    const formattedMessage = this.formatUserMessage(text, activeSkill);
    messages.push({
      role: 'user',
      content: formattedMessage
    });

    return messages;
  }

  getSkillPrompt(activeSkill, programmingLanguage) {
    const { promptLoader } = require('../../prompt-loader');
    return promptLoader.getSkillPrompt(activeSkill, programmingLanguage) || '';
  }

  getIntelligentTranscriptionPrompt(activeSkill, programmingLanguage) {
    let prompt = `# Intelligent Transcription Response System

Assume you are asked a question in ${activeSkill.toUpperCase()} mode. Your job is to intelligently respond to question/message with appropriate brevity.
Assume you are in an interview and you need to perform best in ${activeSkill.toUpperCase()} mode.
Always respond to the point, do not repeat the question or unnecessary information which is not related to ${activeSkill}.`;

    // Add programming language context if provided
    if (programmingLanguage) {
      const lang = String(programmingLanguage).toLowerCase();
      const languageMap = { cpp: 'C++', c: 'C', python: 'Python', java: 'Java', javascript: 'JavaScript', js: 'JavaScript' };
      const fenceTagMap = { cpp: 'cpp', c: 'c', python: 'python', java: 'java', javascript: 'javascript', js: 'javascript' };
      const languageTitle = languageMap[lang] || (lang.charAt(0).toUpperCase() + lang.slice(1));
      const fenceTag = fenceTagMap[lang] || lang || 'text';
      prompt += `\n\nCODING CONTEXT: Respond ONLY in ${languageTitle}. All code blocks must use triple backticks with language tag \`\`\`${fenceTag}\`\`\`. Do not include other languages unless explicitly asked.`;
    }

    prompt += `

## Response Rules:

### If the transcription is casual conversation, greetings, or NOT related to ${activeSkill}:
- Respond with: "Yeah, I'm listening. Ask your question relevant to ${activeSkill}."
- Or similar brief acknowledgments like: "I'm here, what's your ${activeSkill} question?"

### If the transcription IS relevant to ${activeSkill} or is a follow-up question:
- Provide a comprehensive, detailed response
- Use bullet points, examples, and explanations
- Focus on actionable insights and complete answers
- Do not truncate or shorten your response

### Examples of casual/irrelevant messages:
- "Hello", "Hi there", "How are you?"
- "What's the weather like?"
- "I'm just testing this"
- Random conversations not related to ${activeSkill}

### Examples of relevant messages:
- Actual questions about ${activeSkill} concepts
- Follow-up questions to previous responses
- Requests for clarification on ${activeSkill} topics
- Problem-solving requests related to ${activeSkill}

## Response Format:
- Keep responses detailed
- Use bullet points for structured answers
- Be encouraging and helpful
- Stay focused on ${activeSkill}

If the user's input is a coding or DSA problem statement and contains no code, produce a complete, runnable solution in the selected programming language without asking for more details. Always include the final implementation in a properly tagged code block.

Remember: Be intelligent about filtering - only provide detailed responses when the user actually needs help with ${activeSkill}.`;

    return prompt;
  }

  formatUserMessage(text, activeSkill) {
    return `Context: ${activeSkill.toUpperCase()} analysis request\n\nText to analyze:\n${text}`;
  }

  enforceProgrammingLanguage(text, programmingLanguage) {
    try {
      if (!text || !programmingLanguage) return text;
      const norm = String(programmingLanguage).toLowerCase();
      const fenceTagMap = { cpp: 'cpp', c: 'c', python: 'python', java: 'java', javascript: 'javascript', js: 'javascript' };
      const fenceTag = fenceTagMap[norm] || norm || 'text';

      // Replace all triple-backtick fences' language token with the selected tag
      const replacedBackticks = text.replace(/```([^\n]*)\n/g, (match, info) => {
        const current = (info || '').trim();
        // If already the desired fenceTag as the first token, keep as is
        if (current.split(/\s+/)[0].toLowerCase() === fenceTag) return match;
        return '```' + fenceTag + '\n';
      });

      // Optionally normalize tildes fences to backticks with correct tag
      const normalizedTildes = replacedBackticks.replace(/~~~([^\n]*)\n/g, () => '```' + fenceTag + '\n');

      return normalizedTildes;
    } catch (_) {
      return text;
    }
  }

  async makeHttpRequest(url, method, body) {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Stealth-AI/1.0.0'
      },
      timeout: config.get('llm.local.timeout') || 30000
    };

    // Add API key if configured (for some local APIs)
    const apiKey = config.get('llm.local.apiKey');
    if (apiKey) {
      options.headers['Authorization'] = `Bearer ${apiKey}`;
    }

    return new Promise((resolve, reject) => {
      const postData = body ? JSON.stringify(body) : null;
      
      if (postData) {
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = httpModule.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
              return;
            }

            const response = JSON.parse(data);
            resolve(response);
          } catch (parseError) {
            reject(new Error(`Failed to parse response: ${parseError.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (postData) {
        req.write(postData);
      }
      
      req.end();
    });
  }

  async testConnection() {
    if (!this.isInitialized) {
      return { success: false, error: 'Service not initialized' };
    }

    try {
      let testResponse;
      
      switch (this.apiType) {
        case 'ollama':
          testResponse = await this.makeHttpRequest(`${this.baseUrl}/api/generate`, 'POST', {
            model: this.modelName,
            prompt: 'Test connection. Please respond with "OK".',
            stream: false,
            options: { num_predict: 10 }
          });
          break;
          
        case 'localai':
        case 'openai-compatible':
          testResponse = await this.makeHttpRequest(`${this.baseUrl}/v1/chat/completions`, 'POST', {
            model: this.modelName,
            messages: [{ role: 'user', content: 'Test connection. Please respond with "OK".' }],
            max_tokens: 10
          });
          break;
          
        default:
          throw new Error(`Unknown API type: ${this.apiType}`);
      }

      const responseText = testResponse.response || testResponse.choices?.[0]?.message?.content || 'Connection successful';
      
      logger.info('Connection test successful', { 
        response: responseText,
        apiType: this.apiType,
        model: this.modelName
      });
      
      return { 
        success: true, 
        response: responseText.trim(),
        apiType: this.apiType,
        model: this.modelName
      };
    } catch (error) {
      logger.error('Connection test failed', { 
        error: error.message,
        apiType: this.apiType,
        baseUrl: this.baseUrl
      });
      
      return { 
        success: false, 
        error: error.message,
        apiType: this.apiType,
        baseUrl: this.baseUrl
      };
    }
  }

  generateFallbackResponse(text, activeSkill) {
    logger.info('Generating fallback response', { activeSkill });

    const fallbackResponses = {
      'dsa': 'This appears to be a data structures and algorithms problem. Consider breaking it down into smaller components and identifying the appropriate algorithm or data structure to use.',
      'system-design': 'For this system design question, consider scalability, reliability, and the trade-offs between different architectural approaches.',
      'programming': 'This looks like a programming challenge. Focus on understanding the requirements, edge cases, and optimal time/space complexity.',
      'default': 'I can help analyze this content. Please ensure your local LLM is properly configured and running.'
    };

    const response = fallbackResponses[activeSkill] || fallbackResponses.default;
    
    return {
      response,
      metadata: {
        skill: activeSkill,
        processingTime: 0,
        requestId: this.requestCount,
        usedFallback: true,
        apiType: this.apiType
      }
    };
  }

  generateIntelligentFallbackResponse(text, activeSkill) {
    logger.info('Generating intelligent fallback response for transcription', { activeSkill });

    // Simple heuristic to determine if message seems skill-related
    const skillKeywords = {
      'dsa': ['algorithm', 'data structure', 'array', 'tree', 'graph', 'sort', 'search', 'complexity', 'big o'],
      'programming': ['code', 'function', 'variable', 'class', 'method', 'bug', 'debug', 'syntax'],
      'system-design': ['scalability', 'database', 'architecture', 'microservice', 'load balancer', 'cache'],
      'behavioral': ['interview', 'experience', 'situation', 'leadership', 'conflict', 'team'],
      'sales': ['customer', 'deal', 'negotiation', 'price', 'revenue', 'prospect'],
      'presentation': ['slide', 'audience', 'public speaking', 'presentation', 'nervous'],
      'data-science': ['data', 'model', 'machine learning', 'statistics', 'analytics', 'python', 'pandas'],
      'devops': ['deployment', 'ci/cd', 'docker', 'kubernetes', 'infrastructure', 'monitoring'],
      'negotiation': ['negotiate', 'compromise', 'agreement', 'terms', 'conflict resolution']
    };

    const textLower = text.toLowerCase();
    const relevantKeywords = skillKeywords[activeSkill] || [];
    const hasRelevantKeywords = relevantKeywords.some(keyword => textLower.includes(keyword));
    
    // Check for question indicators
    const questionIndicators = ['how', 'what', 'why', 'when', 'where', 'can you', 'could you', 'should i', '?'];
    const seemsLikeQuestion = questionIndicators.some(indicator => textLower.includes(indicator));

    let response;
    if (hasRelevantKeywords || seemsLikeQuestion) {
      response = `I'm having trouble processing that right now, but it sounds like a ${activeSkill} question. Could you rephrase or ask more specifically about what you need help with?`;
    } else {
      response = `Yeah, I'm listening. Ask your question relevant to ${activeSkill}.`;
    }
    
    return {
      response,
      metadata: {
        skill: activeSkill,
        processingTime: 0,
        requestId: this.requestCount,
        usedFallback: true,
        isTranscriptionResponse: true,
        apiType: this.apiType
      }
    };
  }

  getStats() {
    return {
      isInitialized: this.isInitialized,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      successRate: this.requestCount > 0 ? ((this.requestCount - this.errorCount) / this.requestCount) * 100 : 0,
      config: config.get('llm.local'),
      apiType: this.apiType,
      baseUrl: this.baseUrl,
      modelName: this.modelName
    };
  }
}

module.exports = new LocalLLMService();