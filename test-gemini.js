#!/usr/bin/env node

// Test Gemini API Connection
require('dotenv').config();

async function testGeminiConnection() {
    console.log('🧪 Testing Gemini API Connection...\n');

    try {
        // Import required modules
        const config = require('./src/core/config');
        const LLMService = require('./src/services/llm.service');

        console.log('✅ Configuration loaded');

        // Check API key
        const apiKey = config.getApiKey('GEMINI');
        console.log(`✅ API Key found: ${apiKey ? '***' + apiKey.slice(-4) : 'NOT SET'}`);
        
        if (!apiKey || apiKey === 'your_gemini_api_key_here') {
            console.log('❌ Please set your GEMINI_API_KEY in the .env file');
            console.log('   Get your API key from: https://makersuite.google.com/app/apikey');
            return;
        }

        // Wait a moment for initialization
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log(`✅ LLM Service initialized: ${LLMService.isInitialized}`);
        
        if (!LLMService.isInitialized) {
            console.log('❌ LLM Service failed to initialize');
            return;
        }

        // Test connection
        console.log('🔄 Testing connection...');
        const testResult = await LLMService.testConnection();
        
        if (testResult.success) {
            console.log('✅ Connection test successful!');
            console.log(`📝 Response: ${testResult.response}`);
            console.log(`⏱️  Latency: ${testResult.latency || 'unknown'}ms`);
        } else {
            console.log('❌ Connection test failed');
            console.log(`🚫 Error: ${testResult.error}`);
            
            if (testResult.errorAnalysis) {
                console.log(`🔍 Error Type: ${testResult.errorAnalysis.type}`);
                console.log(`💡 Suggestion: ${testResult.errorAnalysis.suggestedAction}`);
            }
        }

        // Test a simple text processing
        console.log('\n🔄 Testing text processing...');
        const textResult = await LLMService.processTextWithSkill(
            'What is 2+2?', 
            'programming'
        );
        
        if (textResult && textResult.response) {
            console.log('✅ Text processing successful!');
            console.log(`📝 Response length: ${textResult.response.length} characters`);
            console.log(`⏱️  Processing time: ${textResult.metadata?.processingTime}ms`);
        } else {
            console.log('❌ Text processing failed');
        }

    } catch (error) {
        console.log('❌ Test failed with error:');
        console.log(`🚫 ${error.message}`);
        
        if (error.stack) {
            console.log('\n📋 Stack trace:');
            console.log(error.stack);
        }
        
        // Common troubleshooting tips
        console.log('\n💡 Troubleshooting tips:');
        console.log('   1. Make sure your GEMINI_API_KEY is set in .env file');
        console.log('   2. Check your internet connection');
        console.log('   3. Verify API key is valid at https://makersuite.google.com/');
        console.log('   4. Make sure you have npm dependencies installed: npm install');
    }
}

// Run the test
if (require.main === module) {
    testGeminiConnection().then(() => {
        console.log('\n🏁 Test completed');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Test script error:', error.message);
        process.exit(1);
    });
}

module.exports = testGeminiConnection;