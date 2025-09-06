// Test script to simulate various LaTeX errors
const fs = require('fs').promises;
const path = require('path');

// Sample LaTeX error log outputs
const errorScenarios = [
  {
    name: "Undefined control sequence",
    log: `This is pdfTeX, Version 3.14159265-2.6-1.40.21
(./document.tex
LaTeX2e <2020-10-01>
! Undefined control sequence.
l.3 \\textbf{Hello \\unknowncommand
                                   World}
? 
! Emergency stop.
l.3 \\textbf{Hello \\unknowncommand
                                   World}
!  ==> Fatal error occurred, no output PDF file produced!`
  },
  {
    name: "Missing package",
    log: `This is pdfTeX, Version 3.14159265-2.6-1.40.21
(./document.tex
LaTeX2e <2020-10-01>
! LaTeX Error: File \`tikz.sty' not found.

Type X to quit or <RETURN> to proceed,
or enter new name. (Default extension: sty)

Enter file name: 
! Emergency stop.
<read *> 
         
l.4 \\usepackage{tikz}
                      ^^M
!  ==> Fatal error occurred, no output PDF file produced!`
  },
  {
    name: "Missing delimiter",
    log: `This is pdfTeX, Version 3.14159265-2.6-1.40.21
(./document.tex
LaTeX2e <2020-10-01>
! Missing } inserted.
<inserted text> 
                }
l.5 \\textbf{Hello World
                         
? 
! Emergency stop.
<inserted text> 
                }
l.5 \\textbf{Hello World
                         
!  ==> Fatal error occurred, no output PDF file produced!`
  },
  {
    name: "Math mode error",
    log: `This is pdfTeX, Version 3.14159265-2.6-1.40.21
(./document.tex
LaTeX2e <2020-10-01>
! Missing $ inserted.
<inserted text> 
                $
l.4 This is math: x^2
                      + y^2 = z^2
? 
! Emergency stop.
<inserted text> 
                $
l.4 This is math: x^2
                      + y^2 = z^2
!  ==> Fatal error occurred, no output PDF file produced!`
  }
];

async function testErrorParsing() {
  console.log("Testing LaTeX error parsing...\n");
  
  for (const scenario of errorScenarios) {
    console.log(`\n=== Testing: ${scenario.name} ===`);
    
    // Create temp directory
    const tempDir = `/tmp/test-latex-${Date.now()}`;
    await fs.mkdir(tempDir, { recursive: true });
    
    // Write test log file
    const logFile = path.join(tempDir, 'document.log');
    await fs.writeFile(logFile, scenario.log);
    
    // Parse the error (simplified version of server logic)
    const logContent = await fs.readFile(logFile, "utf-8");
    const lines = logContent.split('\n');
    
    let errorFound = false;
    let errorLines = [];
    let userFriendlyError = "";
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('!')) {
        errorFound = true;
        for (let j = i; j < Math.min(i + 5, lines.length); j++) {
          errorLines.push(lines[j]);
        }
        
        if (line.includes('Undefined control sequence')) {
          userFriendlyError = "Undefined LaTeX command. Check for typos in commands or missing packages.";
        } else if (line.includes('File') && line.includes('not found')) {
          const match = line.match(/File \`(.+?)'/);
          userFriendlyError = `Missing file or package: ${match ? match[1] : 'unknown'}. Add \\\\usepackage{} for missing packages.`;
        } else if (line.includes('Missing')) {
          userFriendlyError = "Missing delimiter or bracket. Check for unclosed braces, brackets, or math mode.";
        } else if (line.includes('Emergency stop')) {
          userFriendlyError = "Critical LaTeX error. Check document structure and syntax.";
        } else {
          userFriendlyError = line.substring(1).trim();
        }
        break;
      }
    }
    
    console.log("User-friendly error:", userFriendlyError);
    console.log("Error details:", errorLines.slice(0, 3).join('\n'));
    
    // Clean up
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  
  console.log("\\n=== Test complete ===");
}

testErrorParsing().catch(console.error);