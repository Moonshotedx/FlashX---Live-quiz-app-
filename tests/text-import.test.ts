import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { parseQuestionText, type ParsedQuestion } from '../lib/text-import';

const parse = (t: string, defaultPoints?: number) => parseQuestionText(t, { defaultPoints });
const first = (t: string): ParsedQuestion => {
  const r = parse(t);
  assert.ok(r.questions.length >= 1, 'expected at least one question');
  return r.questions[0];
};
const ready = (q: ParsedQuestion) => q.issues.length === 0 && q.correctIndex !== null;

const SAMPLE = `1. What does CPU stand for?
A) Central Processing Unit
B) Computer Personal Unit
C) Central Program Utility
D) Control Processing Unit
Answer: A

Q2. Which language runs natively in a web browser? (2 marks)
a. Java  b. C  c. Python  d. JavaScript
Ans - d

3. Which company makes the Android operating system?
Apple
Google *
Microsoft
Samsung

4. HTML is a programming language.
Answer: False

5. Which planet is known as the Red Planet?
(a) Venus
(b) Mars
(c) Jupiter
(d) Saturn

Answer key
5 - b`;

describe('text-import: the sample from the spec', () => {
  it('reads all five sample questions with no problems and nothing left over', () => {
    const r = parse(SAMPLE);
    assert.equal(r.questions.length, 5);
    assert.deepEqual(r.unparsed, []);
    assert.ok(r.questions.every(ready), JSON.stringify(r.questions.map((q) => q.issues)));

    const [q1, q2, q3, q4, q5] = r.questions;
    assert.equal(q1.text, 'What does CPU stand for?');
    assert.equal(q1.correctIndex, 0);
    assert.equal(q1.options[3], 'Control Processing Unit');

    assert.equal(q2.text, 'Which language runs natively in a web browser?');
    assert.deepEqual(q2.options, ['Java', 'C', 'Python', 'JavaScript']);
    assert.equal(q2.correctIndex, 3);
    assert.equal(q2.points, 2);

    assert.deepEqual(q3.options, ['Apple', 'Google', 'Microsoft', 'Samsung']);
    assert.equal(q3.correctIndex, 1);
    assert.ok(q3.notes.includes('Options had no labels, check the order'));

    assert.deepEqual(q4.options, ['True', 'False']);
    assert.equal(q4.correctIndex, 1);
    assert.ok(q4.notes.includes('True/False options added automatically'));

    assert.equal(q5.correctIndex, 1);
    assert.equal(q5.sourceNumber, 5);
    assert.ok(q5.notes.includes('Answer taken from answer key'));
    assert.deepEqual(
      r.questions.map((q) => q.line),
      [1, 8, 12, 18, 21],
    );
  });
});

describe('text-import: question starts', () => {
  it('numbered questions with A) options and "Answer: B"', () => {
    const r = parse(`1. What is the capital of France?
A) London
B) Paris
C) Berlin
D) Madrid
Answer: B

2) Which is a mammal?
A. Shark
B. Dolphin
Answer: B`);
    assert.equal(r.questions.length, 2);
    assert.equal(r.questions[0].text, 'What is the capital of France?');
    assert.deepEqual(r.questions[0].options, ['London', 'Paris', 'Berlin', 'Madrid']);
    assert.equal(r.questions[0].correctIndex, 1);
    assert.equal(r.questions[0].sourceNumber, 1);
    assert.equal(r.questions[0].line, 1);
    assert.equal(r.questions[1].correctIndex, 1);
    assert.equal(r.questions[1].line, 8);
    assert.ok(r.questions.every(ready));
    assert.deepEqual(r.unparsed, []);
  });

  it('"Q1." style with lowercase a. options and "Ans - c"', () => {
    const q = first(`Q1. Which colour is the sky?
a. Red
b. Green
c. Blue
Ans - c`);
    assert.equal(q.text, 'Which colour is the sky?');
    assert.deepEqual(q.options, ['Red', 'Green', 'Blue']);
    assert.equal(q.correctIndex, 2);
    assert.equal(q.sourceNumber, 1);
  });

  it('recognises every question start format', () => {
    const starts = ['1.', '2)', '3:', '4 -', '(5)', 'Q6.', 'Q7)', 'Q.8', 'Q 9:', 'Question 10:', 'QUESTION 11.', 'question 12 -'];
    const text = starts.map((s) => `${s} Text of it\nA) yes\nB) no\nAnswer: A`).join('\n\n');
    const r = parse(text);
    assert.equal(r.questions.length, starts.length);
    assert.deepEqual(
      r.questions.map((q) => q.sourceNumber),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    );
    assert.ok(r.questions.every((q) => q.text === 'Text of it' && ready(q)));
    assert.deepEqual(r.unparsed, []);
  });

  it('does not treat arithmetic or decimals as new questions', () => {
    const r = parse(`1. What is the value?
10 - 5 = ?
1.5 litres is how many ml?
A) 5
B) 6
Answer: A`);
    assert.equal(r.questions.length, 1);
    assert.equal(r.questions[0].text, 'What is the value?\n10 - 5 = ?\n1.5 litres is how many ml?');
  });

  it('falls back to blank-line blocks when nothing is numbered', () => {
    const r = parse(`Which is a fruit?
a) Apple
b) Car
Answer: a

Name a colour
Red
Blue *
Green

Just some heading text
second line`);
    assert.equal(r.questions.length, 2);
    assert.equal(r.questions[0].correctIndex, 0);
    assert.deepEqual(r.questions[1].options, ['Red', 'Blue', 'Green']);
    assert.equal(r.questions[1].correctIndex, 1);
    assert.deepEqual(
      r.unparsed.map((u) => u.line),
      [11, 12],
    );
  });

  it('keeps multi-line question text', () => {
    const q = first(`1. Read the passage below.
The cat sat on the mat.
What did the cat sit on?
A) Mat
B) Hat
Answer: A`);
    assert.equal(q.text, 'Read the passage below.\nThe cat sat on the mat.\nWhat did the cat sit on?');
    assert.deepEqual(q.options, ['Mat', 'Hat']);
    assert.ok(ready(q));
  });
});

describe('text-import: options', () => {
  it('splits several options on one line', () => {
    const r = parse(`1. Which language runs in a browser?
a. Java  b. C  c. Python  d. JavaScript
Answer: d

2. When was Java released?
A) 1990 B) 1995 C) 2000 D) 2005
Answer: B`);
    assert.deepEqual(r.questions[0].options, ['Java', 'C', 'Python', 'JavaScript']);
    assert.equal(r.questions[0].correctIndex, 3);
    assert.deepEqual(r.questions[1].options, ['1990', '1995', '2000', '2005']);
    assert.equal(r.questions[1].correctIndex, 1);
  });

  it('accepts (A) [A] a) (a) A: A - label styles and roman numerals', () => {
    const styles = [
      ['(A) one', '(B) two', 'B'],
      ['[A] one', '[B] two', 'B'],
      ['a) one', 'b) two', 'b'],
      ['(a) one', '(b) two', '(b)'],
      ['A: one', 'B: two', 'B'],
      ['A - one', 'B - two', 'B'],
      ['(i) one', '(ii) two', 'ii'],
      ['i) one', 'ii) two', '(ii)'],
    ];
    for (const [a, b, ans] of styles) {
      const q = first(`1. Pick\n${a}\n${b}\nAnswer: ${ans}`);
      assert.deepEqual(q.options, ['one', 'two'], `labels ${a}`);
      assert.equal(q.correctIndex, 1, `labels ${a}`);
    }
  });

  it('reads roman numeral answers', () => {
    const q = first(`1. Pick one
(i) a
(ii) b
(iii) c
Answer: (ii)`);
    assert.equal(q.correctIndex, 1);
  });

  it('does not split a normal sentence that contains "a."', () => {
    const q = first(`1. Which statement about a. variables is true? a. They store data
The letter a. is a vowel
A) Paris is a. city
B) London
Answer: A`);
    assert.equal(q.text, 'Which statement about a. variables is true? a. They store data\nThe letter a. is a vowel');
    assert.deepEqual(q.options, ['Paris is a. city', 'London']);
    assert.equal(q.correctIndex, 0);
  });

  it('does not treat "e.g." as option E', () => {
    const q = first(`1. Name a fruit
e.g. apple
A) Mango
B) Car
Answer: A`);
    assert.equal(q.text, 'Name a fruit\ne.g. apple');
    assert.equal(q.options.length, 2);
  });

  it('treats 2 to 6 short unlabelled lines as options and adds a note', () => {
    const q = first(`1. Which company makes Android?
Apple
Google
Microsoft
Answer: B`);
    assert.deepEqual(q.options, ['Apple', 'Google', 'Microsoft']);
    assert.equal(q.correctIndex, 1);
    assert.ok(q.notes.includes('Options had no labels, check the order'));
  });

  it('creates True/False options when there are none and the answer is true or false', () => {
    const r = parse(`1. HTML is a programming language.
Answer: False

2. The earth is round.
Ans: T

3. Water boils at 50 C.
Correct: f`);
    assert.deepEqual(
      r.questions.map((q) => [q.options.join('/'), q.correctIndex]),
      [
        ['True/False', 1],
        ['True/False', 0],
        ['True/False', 1],
      ],
    );
    assert.ok(r.questions.every((q) => q.notes.includes('True/False options added automatically') && q.issues.length === 0));
  });
});

describe('text-import: correct answers', () => {
  it('accepts every answer line spelling', () => {
    const lines = [
      'Answer: B',
      'Ans: b',
      'Ans - b',
      'Ans.(b)',
      'Correct: B',
      'Correct answer - B',
      'Key: B',
      'Solution: B',
      'Right answer: B',
      'ANSWER = b',
      'Answer: (b)',
      'Answer: option b',
      'Answer: 2',
    ];
    for (const l of lines) {
      const q = first(`1. Pick\nA) one\nB) two\nC) three\n${l}`);
      assert.equal(q.correctIndex, 1, l);
      assert.deepEqual(q.issues, [], l);
    }
  });

  it('matches the answer by option text ignoring case and punctuation, with a note', () => {
    const r = parse(`1. Capital of France?
A) London
B) Paris
Answer: paris!

2. Largest planet?
A) Mars
B) Jupiter (gas giant)
Answer: JUPITER  gas giant`);
    assert.equal(r.questions[0].correctIndex, 1);
    assert.ok(r.questions[0].notes.includes('Answer matched by text'));
    assert.equal(r.questions[1].correctIndex, 1);
    assert.ok(r.questions[1].notes.includes('Answer matched by text'));
  });

  it('uses the letter in "B) Paris" and blocks when the text does not match', () => {
    const good = first(`1. Capital?\nA) London\nB) Paris\nAnswer: B) Paris`);
    assert.equal(good.correctIndex, 1);
    assert.deepEqual(good.issues, []);
    const bad = first(`1. Capital?\nA) London\nB) Paris\nAnswer: A) Paris`);
    assert.equal(bad.correctIndex, null);
    assert.ok(bad.issues.includes('Answer letter and text do not match'));
  });

  it('blocks an answer that points at an option that does not exist', () => {
    const q = first(`1. Pick\nA) a\nB) b\nC) c\nD) d\nAnswer: E`);
    assert.equal(q.correctIndex, null);
    assert.ok(q.issues.includes('Answer E does not match any option'));
    const n = first(`1. Pick\nA) a\nB) b\nAnswer: 5`);
    assert.ok(n.issues.includes('Answer 5 does not match any option'));
  });

  it('asks instead of guessing when a number could be a position or an option text', () => {
    const q = first(`1. Pick\nA) 3\nB) 1\nC) 2\nAnswer: 2`);
    assert.equal(q.correctIndex, null);
    assert.ok(q.issues.some((i) => i.includes('could mean')));
    const t = first(`1. Pick\nA) 10\nB) 20\nAnswer: 20`);
    assert.equal(t.correctIndex, 1);
    assert.deepEqual(t.issues, []);
  });

  it('reads * and checkmark markers and removes them from the option text', () => {
    const r = parse(`1. Capital of France?
A) London
B) Paris *
C) Berlin

2. Largest planet?
A) Mars
✓ B) Jupiter
C) Saturn

3. Colour of the sky?
A) Blue ✔
B) Green

4. Fastest animal?
A) Cheetah (correct)
B) Snail

5. Biggest ocean?
A) Atlantic
B) Pacific [correct]

6. Hottest planet?
A) Venus <-
B) Mars

7. Smallest prime?
A) 1
B) 2 <--

8. Opposite of up?
A) Down ✅
B) Left`);
    assert.equal(r.questions.length, 8);
    const expected = [
      [1, 'Paris'],
      [1, 'Jupiter'],
      [0, 'Blue'],
      [0, 'Cheetah'],
      [1, 'Pacific'],
      [0, 'Venus'],
      [1, '2'],
      [0, 'Down'],
    ] as const;
    r.questions.forEach((q, i) => {
      assert.equal(q.correctIndex, expected[i][0], `q${i + 1}`);
      assert.equal(q.options[expected[i][0]], expected[i][1], `q${i + 1}`);
      assert.deepEqual(q.issues, [], `q${i + 1}`);
      assert.ok(q.options.every((o) => !/[*✓✔✅]|\(correct\)|\[correct\]|<-/.test(o)), `q${i + 1} marker left in text`);
    });
  });

  it('reads bold on exactly one option as the answer, and ignores bold on several', () => {
    const one = first(`1. Capital of France?\nA) London\n**B) Paris**\nC) Rome`);
    assert.equal(one.correctIndex, 1);
    assert.deepEqual(one.options, ['London', 'Paris', 'Rome']);
    assert.equal(one.text, 'Capital of France?');
    const many = first(`1. Capital of France?\n**A) London**\n**B) Paris**\nC) Rome`);
    assert.equal(many.correctIndex, null);
    assert.ok(many.issues.includes('No correct answer found - click the right option'));
    const boldQuestion = first(`**1. Capital of France?**\nA) London\nB) Paris\nAnswer: B`);
    assert.equal(boldQuestion.text, 'Capital of France?');
  });

  it('unwraps WhatsApp-style *bold* question lines', () => {
    const q = first(`*1. Capital of France?*\nA) London\nB) Paris\nAnswer: B`);
    assert.equal(q.text, 'Capital of France?');
    assert.equal(q.sourceNumber, 1);
    assert.equal(q.correctIndex, 1);
  });

  it('keeps blanks like "______" in question text', () => {
    const q = first(`1. The capital of France is ______.\nA) Paris\nB) Rome\nAnswer: A`);
    assert.equal(q.text, 'The capital of France is ______.');
  });

  it('reads an answer key, comma separated, with questions numbered out of order', () => {
    const r = parse(`2. Question two?
A) a2
B) b2

1. Question one?
A) a1
B) b1

3. Question three?
A) a3
B) b3

Answer key
1-B, 2-A, 3-B`);
    assert.deepEqual(
      r.questions.map((q) => [q.sourceNumber, q.correctIndex]),
      [
        [2, 0],
        [1, 1],
        [3, 1],
      ],
    );
    assert.ok(r.questions.every((q) => q.notes.includes('Answer taken from answer key') && q.issues.length === 0));
    assert.deepEqual(r.unparsed, []);
  });

  it('reads an answer key with one entry per line in several spellings', () => {
    const r = parse(`1. First?
A) a
B) b

2. Second?
A) a
B) b

3. Third?
A) a
B) Paris

4. Fourth?
A) a
B) b

Answers:
1. B
2) a
Q3: Paris
4 - B`);
    assert.deepEqual(
      r.questions.map((q) => q.correctIndex),
      [1, 0, 1, 1],
    );
    assert.deepEqual(r.unparsed, []);
  });

  it('matches an answer key by order when questions are not numbered', () => {
    const r = parse(`Which is a fruit?
a) Apple
b) Car

Which is a vehicle?
a) Bus
b) Pear

Key
1-A, 2-A`);
    assert.deepEqual(
      r.questions.map((q) => q.correctIndex),
      [0, 0],
    );
  });

  it('puts answer key entries that match no question in "could not read"', () => {
    const r = parse(`1. Only one?\nA) a\nB) b\n\nAnswers\n1-A, 9-C`);
    assert.equal(r.questions[0].correctIndex, 0);
    assert.deepEqual(r.unparsed, [{ line: 6, text: '9-C' }]);
  });

  it('does not eat the next question when it follows an answer key heading', () => {
    const r = parse(`1. One?\nA) a\nB) b\n\nAnswers\n1-A\n\n2. Two?\nA) x\nB) y\nAnswer: B`);
    assert.equal(r.questions.length, 2);
    assert.equal(r.questions[1].correctIndex, 1);
  });
});

describe('text-import: conflicts and missing answers', () => {
  it('flags a marker that disagrees with the answer line', () => {
    const q = first(`1. Pick\nA) one *\nB) two\nC) three\nAnswer: C`);
    assert.equal(q.correctIndex, null);
    assert.ok(q.issues.includes('Two different answers found'));
  });

  it('flags two markers, and an answer key that disagrees with a marker', () => {
    const two = first(`1. Pick\nA) one *\nB) two *`);
    assert.ok(two.issues.includes('Two different answers found'));
    const key = parse(`1. Pick\nA) one *\nB) two\n\nAnswer key\n1-B`).questions[0];
    assert.ok(key.issues.includes('Two different answers found'));
    assert.equal(key.correctIndex, null);
  });

  it('accepts a marker and an answer line that agree', () => {
    const q = first(`1. Pick\nA) one\nB) two *\nAnswer: B`);
    assert.equal(q.correctIndex, 1);
    assert.deepEqual(q.issues, []);
  });

  it('never guesses: a missing answer is blocking and correctIndex is null', () => {
    const r = parse(`1. Pick\nA) one\nB) two\n\n2. Pick again\nA) x\nB) y`);
    for (const q of r.questions) {
      assert.equal(q.correctIndex, null);
      assert.ok(q.issues.includes('No correct answer found - click the right option'));
    }
  });
});

describe('text-import: points', () => {
  it('reads points in brackets, as 2M, and on a separate line, and removes them from the text', () => {
    const r = parse(`1. First? (2 marks)
A) a
B) b
Answer: A

2. Second? [3 points]
A) a
B) b
Answer: A

3. Third? (4 pts)
A) a
B) b
Answer: A

4. Name the capital 5M
A) a
B) b
Answer: A

5. Fifth?
Points: 7
A) a
B) b
Answer: A

6. Sixth?
A) a
B) b
Answer: A
Marks: 8

7. Seventh?
A) a
B) b
Answer: A`);
    assert.deepEqual(
      r.questions.map((q) => q.points),
      [2, 3, 4, 5, 7, 8, 1],
    );
    assert.deepEqual(
      r.questions.map((q) => q.text),
      ['First?', 'Second?', 'Third?', 'Name the capital', 'Fifth?', 'Sixth?', 'Seventh?'],
    );
    assert.deepEqual(r.unparsed, []);
  });

  it('uses the default points and clamps to 0 to 100', () => {
    const r = parseQuestionText(`1. One?\nA) a\nB) b\nAnswer: A\n\n2. Two? (500 marks)\nA) a\nB) b\nAnswer: A`, { defaultPoints: 3 });
    assert.deepEqual(
      r.questions.map((q) => q.points),
      [3, 100],
    );
    assert.equal(parseQuestionText(`1. One?\nA) a\nB) b\nAnswer: A`, { defaultPoints: 999 }).questions[0].points, 100);
  });
});

describe('text-import: pasted text clean-up', () => {
  it('handles Windows line endings, smart quotes, bullets, non-breaking spaces and zero-width characters', () => {
    const text =
      '1. What\u00A0is \u201CHTML\u201D?\r\n\u2022 A) Markup \u200Blanguage\r\n- B) Programming language\r\n\u25AA C) It\u2019s a database\r\nAnswer: A\r\n';
    const q = first(text);
    assert.equal(q.text, 'What is "HTML"?');
    assert.deepEqual(q.options, ['Markup language', 'Programming language', "It's a database"]);
    assert.equal(q.correctIndex, 0);
    assert.deepEqual(parse(text).unparsed, []);
  });

  it('reads markdown headings and bullets', () => {
    const q = first(`## 1. Pick\n- A) one\n- B) two\nAnswer: B`);
    assert.equal(q.text, 'Pick');
    assert.deepEqual(q.options, ['one', 'two']);
  });
});

describe('text-import: validation', () => {
  it('blocks more than 6 options', () => {
    const q = first(`1. Pick\nA) 1\nB) 2\nC) 3\nD) 4\nE) 5\nF) 6\nG) 7\nAnswer: A`);
    assert.equal(q.options.length, 7);
    assert.ok(q.issues.some((i) => i.includes('7 options')));
  });

  it('blocks fewer than 2 options, empty text, empty options and duplicate options', () => {
    assert.ok(first(`1. Pick\nA) only\nAnswer: A`).issues.some((i) => i.includes('at least 2 options')));
    assert.ok(first(`1.\nA) a\nB) b\nAnswer: A`).issues.includes('The question text is empty'));
    assert.ok(first(`1. Pick\nA) a\nB)\nAnswer: A`).issues.includes('An option is empty'));
    assert.ok(first(`1. Pick\nA) Paris\nB) paris!\nAnswer: A`).issues.includes('Two options have the same text'));
  });

  it('blocks text longer than the server allows', () => {
    const long = 'x'.repeat(1001);
    assert.ok(first(`1. ${long}\nA) a\nB) b\nAnswer: A`).issues.some((i) => i.includes('longer than 1000')));
    assert.ok(first(`1. Pick\nA) ${'y'.repeat(301)}\nB) b\nAnswer: B`).issues.some((i) => i.includes('longer than 300')));
  });

  it('flags out-of-order or repeated labels instead of silently merging questions', () => {
    const q = first(`1. Pick\nA) a\nB) b\nA) c\nB) d\nAnswer: A`);
    assert.ok(q.issues.some((i) => i.includes('out of order')));
  });
});

describe('text-import: nothing is silently dropped', () => {
  it('reports text before the first question, stray lines after options, and unreadable blocks', () => {
    const r = parse(`My Quiz Title
1. Q?
A) a
B) b
Answer: A
Explanation: it is a
Some stray line`);
    assert.equal(r.questions.length, 1);
    assert.deepEqual(r.unparsed, [
      { line: 1, text: 'My Quiz Title' },
      { line: 6, text: 'Explanation: it is a' },
      { line: 7, text: 'Some stray line' },
    ]);
  });

  it('reports every line of text that is not a question', () => {
    const r = parse('hello\nworld\n123');
    assert.equal(r.questions.length, 0);
    assert.deepEqual(r.unparsed, [
      { line: 1, text: 'hello' },
      { line: 2, text: 'world' },
      { line: 3, text: '123' },
    ]);
  });

  it('returns nothing for empty input', () => {
    assert.deepEqual(parse(''), { questions: [], unparsed: [] });
    assert.deepEqual(parse('  \n\n \t\n'), { questions: [], unparsed: [] });
  });
});

describe('text-import: speed', () => {
  it('parses 100 questions in under 100 ms', () => {
    const blocks: string[] = [];
    for (let i = 1; i <= 100; i++) {
      blocks.push(`${i}. Question number ${i} about something? (2 marks)\nA) Option one ${i}\nB) Option two ${i}\nC) Option three ${i}\nD) Option four ${i}\nAnswer: ${'ABCD'[i % 4]}`);
    }
    const text = blocks.join('\n\n');
    parse(text); // warm up regex compilation
    const t0 = performance.now();
    const r = parse(text);
    const ms = performance.now() - t0;
    assert.equal(r.questions.length, 100);
    assert.ok(r.questions.every(ready));
    assert.ok(ms < 100, `took ${ms.toFixed(1)} ms`);
  });
});
