#!/usr/bin/env node

// Simple integration test for Gemini in the application context
require('dotenv').config();

async function testGeminiIntegration() {
    console.log('🧪 Testing Gemini Integration in Application Context...\n');

    try {
        // Test different skills and scenarios
        const config = require('./src/core/config');
        const LLMService = require('./src/services/llm.service');

        console.log('✅ Services loaded successfully');
        
        // Wait for initialization
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log(`✅ LLM Service initialized: ${LLMService.isInitialized}`);
        console.log(`📊 Model: ${config.get('llm.gemini.model')}`);

        // Test different skills
        const testCases = [
            {
                skill: 'dsa',
                text: 'What is the time complexity of quicksort?',
                programmingLanguage: 'python'
            },
            {
                skill: 'programming',
                text: 'Write a function to reverse a string',
                programmingLanguage: 'javascript'
            },
            {
                skill: 'system-design',
                text: 'How would you design a URL shortener like bit.ly?'
            }
        ];

        console.log(`\n🔄 Running ${testCases.length} test cases...\n`);

        for (let i = 0; i < testCases.length; i++) {
            const testCase = testCases[i];
            console.log(`\n📝 Test ${i + 1}: ${testCase.skill.toUpperCase()}`);
            console.log(`📋 Question: ${testCase.text}`);
            if (testCase.programmingLanguage) {
                console.log(`🔧 Language: ${testCase.programmingLanguage}`);
            }

            try {
                const startTime = Date.now();
                const result = await LLMService.processTextWithSkill(
                    testCase.text,
                    testCase.skill,
                    [],
                    testCase.programmingLanguage
                );
                const duration = Date.now() - startTime;

                if (result && result.response) {
                    console.log(`✅ Success (${duration}ms)`);
                    console.log(`📏 Response length: ${result.response.length} characters`);
                    console.log(`🎯 Preview: ${result.response.substring(0, 100)}...`);
                } else {
                    console.log(`❌ Failed - No response received`);
                }

            } catch (error) {
                console.log(`❌ Failed - ${error.message}`);
            }
        }

        // Test transcription response (simulating voice input)
        console.log(`\n🎤 Testing transcription with intelligent response...\n`);
        
        const transcriptionCases = [
            {
                skill: 'dsa',
                text: 'hello',
                expected: 'brief acknowledgment'
            },
            {
                skill: 'programming',
                text: 'how do I sort an array in Python?',
                expected: 'detailed response'
            }
        ];

        for (let i = 0; i < transcriptionCases.length; i++) {
            const testCase = transcriptionCases[i];
            console.log(`\n🎙️ Transcription Test ${i + 1}: "${testCase.text}"`);
            console.log(`🎯 Expected: ${testCase.expected}`);

            try {
                const result = await LLMService.processTranscriptionWithIntelligentResponse(
                    testCase.text,
                    testCase.skill,
                    []
                );

                if (result && result.response) {
                    console.log(`✅ Success`);
                    console.log(`📝 Response: ${result.response}`);
                } else {
                    console.log(`❌ Failed - No response received`);
                }

            } catch (error) {
                console.log(`❌ Failed - ${error.message}`);
            }
        }

        // Get service statistics
        console.log(`\n📊 Service Statistics:`);
        const stats = LLMService.getStats();
        console.log(`   • Initialized: ${stats.isInitialized}`);
        console.log(`   • Total Requests: ${stats.requestCount}`);
        console.log(`   • Errors: ${stats.errorCount}`);
        console.log(`   • Success Rate: ${stats.successRate.toFixed(1)}%`);

    } catch (error) {
        console.log('❌ Integration test failed:');
        console.log(`🚫 ${error.message}`);
        
        if (error.stack) {
            console.log('\n📋 Stack trace:');
            console.log(error.stack);
        }
    }
}

// Run the integration test
if (require.main === module) {
    testGeminiIntegration().then(() => {
        console.log('\n🏁 Integration test completed');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Test script error:', error.message);
        process.exit(1);
    });
}

module.exports = testGeminiIntegration;