const axios = require('axios');

// Test LaTeX with intentional errors
const errorLatex = `\\documentclass{article}
\\usepackage{graphicx}

\\begin{document}

\\title{Test Resume with Errors}
\\author{John Doe}
\\maketitle

\\section{Education}
\\textbf{University Name} \\\\
Bachelor of Science in Computer Science \\\\
GPA: 3.8/4.0

\\section{Experience}
\\subsection{Software Engineer}
\\begin{itemize}
    \\item Developed web applications using React and Node.js
    \\item Implemented \\textcolor{blue}{colorful} features % Missing color package
    \\item Used \\LaTeXe commands % Incorrect command
\\end{itemize}

\\section{Skills}
\\begin{tabular}{ll}
Programming & Python, JavaScript, Java \\\\
Tools & Git, Docker, AWS
% Missing end tabular

\\section{Projects}
\\textbf{Project Name}
\\begin{itemize}
    \\item Built using \\unknowncommand{test} % Undefined command
    \\item Achieved 99% uptime
\\end{itemize

% Missing end document
`

async function testCompilation() {
  try {
    console.log('Testing LaTeX compilation with errors...');
    
    const response = await axios.post('http://localhost:3000/compile', {
      latex: errorLatex,
      autoFix: true
    }, {
      responseType: 'arraybuffer',
      validateStatus: () => true // Accept any status
    });

    if (response.status === 200) {
      console.log('✅ Success! PDF generated after auto-fixing');
      console.log('Headers:', response.headers);
      console.log('LLM Fixed:', response.headers['x-llm-fixed']);
      console.log('Attempts:', response.headers['x-compilation-attempts']);
      
      // Save the PDF
      const fs = require('fs');
      fs.writeFileSync('test-output.pdf', response.data);
      console.log('PDF saved as test-output.pdf');
    } else {
      const errorData = JSON.parse(response.data.toString());
      console.log('❌ Failed to compile even with auto-fix');
      console.log('Error:', errorData.error);
      console.log('LLM Suggestions:', errorData.llmSuggestions);
      console.log('Attempts:', errorData.attempts);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

// Test with autoFix disabled
async function testWithoutAutoFix() {
  try {
    console.log('\nTesting without auto-fix...');
    
    const response = await axios.post('http://localhost:3000/compile', {
      latex: errorLatex,
      autoFix: false
    }, {
      responseType: 'arraybuffer',
      validateStatus: () => true
    });

    if (response.status === 200) {
      console.log('✅ Success! PDF generated');
    } else {
      const errorData = JSON.parse(response.data.toString());
      console.log('❌ Failed as expected (no auto-fix)');
      console.log('Error:', errorData.error);
      console.log('Details:', errorData.details);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

// Run tests
(async () => {
  await testCompilation();
  await testWithoutAutoFix();
})();