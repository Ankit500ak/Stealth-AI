#!/usr/bin/env node

// List available Gemini models
require('dotenv').config();

async function listAvailableModels() {
    console.log('📋 Listing Available Gemini Models...\n');

    try {
        const config = require('./src/core/config');
        
        // Check API key
        const apiKey = config.getApiKey('GEMINI');
        console.log(`✅ API Key found: ${apiKey ? '***' + apiKey.slice(-4) : 'NOT SET'}`);
        
        if (!apiKey || apiKey === 'your_gemini_api_key_here') {
            console.log('❌ Please set your GEMINI_API_KEY in the .env file');
            return;
        }

        // Import Google Generative AI
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const client = new GoogleGenerativeAI(apiKey);

        console.log('🔄 Fetching available models...\n');
        
        // List models using the correct method
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${data.error?.message || 'Unknown error'}`);
        }
        
        const models = data.models || [];
        
        console.log(`📊 Found ${models.length} available models:\n`);
        
        models.forEach((model, index) => {
            console.log(`${index + 1}. ${model.name}`);
            console.log(`   Display Name: ${model.displayName || 'N/A'}`);
            console.log(`   Description: ${model.description || 'N/A'}`);
            console.log(`   Supported Methods: ${model.supportedGenerationMethods?.join(', ') || 'N/A'}`);
            console.log('');
        });

        // Recommend models for generateContent
        const contentModels = models.filter(model => 
            model.supportedGenerationMethods?.includes('generateContent')
        );
        
        console.log('🎯 Recommended models for generateContent:');
        contentModels.forEach((model) => {
            console.log(`   - ${model.name}`);
        });

    } catch (error) {
        console.log('❌ Failed to list models:');
        console.log(`🚫 ${error.message}`);
        
        if (error.stack) {
            console.log('\n📋 Stack trace:');
            console.log(error.stack);
        }
    }
}

// Run the script
if (require.main === module) {
    listAvailableModels().then(() => {
        console.log('\n🏁 Model listing completed');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Script error:', error.message);
        process.exit(1);
    });
}

module.exports = listAvailableModels;