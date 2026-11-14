// Tiny fixture DB for server tests (not the real question bank).
const fs = require('fs');
const A = (name, score, aliases = [], pearl) => ({ name, score, aliases, ...(pearl ? { pearl } : {}) });
const db = {
  version: 1, generated_at: new Date().toISOString(), generator: 'test fixture', review_status: 'unreviewed',
  prompts: [
    { id: 'fx-std', category: 'Diagnostic Dilemmas', prompt: 'Name causes of fever of unknown origin.', difficulty: 'standard', source: 'fixture',
      answers: [A('Tuberculosis', 10, ['tb']), A('Lymphoma', 8), A('Endocarditis', 8, ['infective endocarditis']), A('Adult-onset Still disease', 30, ['aosd']),
        A('Whipple disease', -10, ['tropheryma whipplei']), A('Erdheim-Chester disease', 92, ['ecd'], 'Histiocytosis with long-bone sclerosis.'),
        A('Schnitzler syndrome', 93, [], 'Chronic urticaria with monoclonal IgM.'), A('Hemophagocytic lymphohistiocytosis', 55, ['hlh'])] },
    { id: 'fx-imp', category: 'Complex Pathophysiology', prompt: 'Name paraneoplastic antibodies.', difficulty: 'impossible', source: 'fixture',
      answers: [A('Anti-Hu antibody', 60, ['anna-1']), A('Anti-KLHL11 antibody', 100, [], 'Seen with testicular germ cell tumours.'),
        A('Anti-mGluR1 antibody', 100), A('Anti-GABA-B receptor encephalitis', 94), A('Anti-GABA-A receptor encephalitis', 100)] },
  ],
};
fs.writeFileSync(__dirname + '/fixture_db.json', JSON.stringify(db, null, 2));
