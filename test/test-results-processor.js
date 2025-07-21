module.exports = (results) => {
  // Custom test results processing
  const { testResults, numFailedTests, numPassedTests, numTotalTests } = results;
  
  console.log('\n📊 Test Results Summary:');
  console.log(`✅ Passed: ${numPassedTests}`);
  console.log(`❌ Failed: ${numFailedTests}`);
  console.log(`📝 Total: ${numTotalTests}`);
  
  if (numFailedTests > 0) {
    console.log('\n❌ Failed Tests:');
    testResults.forEach((testResult) => {
      if (testResult.numFailingTests > 0) {
        console.log(`  📁 ${testResult.testFilePath}`);
        testResult.testResults.forEach((test) => {
          if (test.status === 'failed') {
            console.log(`    ❌ ${test.title}`);
            if (test.failureMessages && test.failureMessages.length > 0) {
              console.log(`       ${test.failureMessages[0].split('\n')[0]}`);
            }
          }
        });
      }
    });
  }
  
  // Calculate coverage summary if available
  if (results.coverageMap) {
    const coverage = results.coverageMap.getCoverageSummary();
    console.log('\n📈 Coverage Summary:');
    console.log(`  Lines: ${coverage.lines.pct}%`);
    console.log(`  Functions: ${coverage.functions.pct}%`);
    console.log(`  Branches: ${coverage.branches.pct}%`);
    console.log(`  Statements: ${coverage.statements.pct}%`);
  }
  
  console.log('\n' + '='.repeat(50));
  
  return results;
};