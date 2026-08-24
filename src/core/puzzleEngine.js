// src/core/puzzleEngine.js

/**
 * PuzzleEngine — Generates cognitive-friction math puzzles with dynamic difficulty.
 *
 * Difficulty escalates based on how frequently the user has attempted to bypass
 * the blocker within a rolling 15-minute window.
 */

class PuzzleEngine {
  constructor() {
  }

  /**
   * Calculates dynamic difficulty level (1–3) based on daily open count for the app.
   * @param {string} appName
   * @returns {number} Difficulty level: 1 (easy), 2 (medium), 3 (hard)
   */
  calculateDifficulty(dailyOpens) {

    if (dailyOpens <= 3) return 1; // Easy
    if (dailyOpens <= 5) return 2; // Medium
    return 3; // Hard
  }

  /**
   * Returns a random integer between min and max (inclusive).
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  getRandomNumber(min, max) {
    if (min > max) [min, max] = [max, min];
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Safely evaluates a simple arithmetic expression without using eval/Function.
   * @param {number} a - Left operand
   * @param {string} operator - One of '+', '-', '*'
   * @param {number} b - Right operand
   * @returns {number} Result of the arithmetic operation
   */
  safeEvaluate(a, operator, b) {
    switch (operator) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      default: return a + b; // Fallback to addition
    }
  }

  /**
   * Generates a math puzzle with difficulty scaled to daily app usage frequency.
   * @param {string} appName
   * @returns {{ question: string, expectedAnswer: number, difficultyLevel: number }}
   */
  generateMathPuzzle(dailyOpens) {
    const difficulty = this.calculateDifficulty(dailyOpens);
    let questionText = '';
    let expectedAnswer = 0;

    if (difficulty === 1) {
      // Easy: 2-digit addition or subtraction
      const operator = Math.random() > 0.5 ? '+' : '-';
      let num1 = this.getRandomNumber(10, 99);
      let num2 = this.getRandomNumber(10, 99);
      if (operator === '-' && num1 < num2) [num1, num2] = [num2, num1];
      
      questionText = `${num1} ${operator} ${num2}`;
      expectedAnswer = this.safeEvaluate(num1, operator, num2);
    } else if (difficulty === 2) {
      // Medium: Multiplications or 3-term operations
      if (Math.random() > 0.5) {
        // Multiplication (e.g. 12 * 7)
        const num1 = this.getRandomNumber(11, 20);
        const num2 = this.getRandomNumber(4, 9);
        questionText = `${num1} * ${num2}`;
        expectedAnswer = num1 * num2;
      } else {
        // 3-term operation (e.g. A + B - C)
        const num1 = this.getRandomNumber(20, 50);
        const num2 = this.getRandomNumber(10, 40);
        const num3 = this.getRandomNumber(10, 30);
        questionText = `${num1} + ${num2} - ${num3}`;
        expectedAnswer = num1 + num2 - num3;
      }
    } else {
      // Hard: Parenthetical operations or 2-digit multiplication
      if (Math.random() > 0.5) {
        // 2-digit multiplication (e.g. 15 * 12)
        const num1 = this.getRandomNumber(11, 19);
        const num2 = this.getRandomNumber(11, 19);
        questionText = `${num1} * ${num2}`;
        expectedAnswer = num1 * num2;
      } else {
        // Parenthetical (e.g. (14 + 16) * 3)
        const num1 = this.getRandomNumber(10, 30);
        const num2 = this.getRandomNumber(10, 30);
        const num3 = this.getRandomNumber(2, 6);
        questionText = `(${num1} + ${num2}) * ${num3}`;
        expectedAnswer = (num1 + num2) * num3;
      }
    }

    return {
      question: `Solve to unlock (Difficulty Level ${difficulty}):\n${questionText}`,
      expectedAnswer,
      difficultyLevel: difficulty,
    };
  }

  /**
   * Verifies the user's answer against the puzzle's expected answer.
   * Records the timestamp on success to scale future difficulty.
   *
   * @param {string} userInput - The user's submitted answer (string from TextInput)
   * @param {object|null} puzzleObject - The puzzle object from generateMathPuzzle()
   * @returns {boolean} Whether the answer is correct
   */
  verifyAnswer(userInput, puzzleObject) {
    // Defensive: guard against null/undefined puzzle or input
    if (!puzzleObject || puzzleObject.expectedAnswer == null) return false;
    if (userInput == null || String(userInput).trim() === '') return false;

    const parsed = parseInt(String(userInput).trim(), 10);
    if (Number.isNaN(parsed)) return false;

    const isCorrect = parsed === puzzleObject.expectedAnswer;
    return isCorrect;
  }
}

export default new PuzzleEngine();
