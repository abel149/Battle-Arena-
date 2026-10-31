/**
 * @file BrainQuizModal.jsx
 * @description 5-Question educational brain quiz modal allowing kids to earn +2 Energy.
 */

import { useMemo, useState } from 'react';
import { API } from '../socket.js';

// 5-Question Brain Quiz questions pool
export const QUIZ_QUESTIONS_POOL = [
  {
    q: 'What is 15 × 6?',
    options: ['80', '90', '95', '85'],
    correct: 1,
    category: 'Math',
  },
  {
    q: 'Which planet is known as the Red Planet?',
    options: ['Venus', 'Jupiter', 'Mars', 'Mercury'],
    correct: 2,
    category: 'Science',
  },
  {
    q: 'How many sides does a hexagon have?',
    options: ['5', '6', '7', '8'],
    correct: 1,
    category: 'Geometry',
  },
  {
    q: 'Which gas do plants absorb from the air for photosynthesis?',
    options: ['Oxygen', 'Carbon Dioxide', 'Nitrogen', 'Helium'],
    correct: 1,
    category: 'Science',
  },
  {
    q: 'What is 144 ÷ 12?',
    options: ['11', '12', '14', '16'],
    correct: 1,
    category: 'Math',
  },
  {
    q: 'What is the capital city of France?',
    options: ['Berlin', 'Madrid', 'Rome', 'Paris'],
    correct: 3,
    category: 'Geography',
  },
];

export function categoryIcon(cat) {
  switch (cat) {
    case 'cleaning':
      return '🧹';
    case 'homework':
      return '📝';
    case 'reading':
      return '📚';
    case 'study':
      return '🧠';
    case 'fitness':
      return '🏃';
    case 'pets':
      return '🐕';
    default:
      return '⭐';
  }
}

export default function BrainQuizModal({ onClose, wallet, onSuccess }) {
  const questions = useMemo(() => {
    // Pick 5 random questions from the pool
    const shuffled = [...QUIZ_QUESTIONS_POOL].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 5);
  }, []);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const currentQ = questions[currentIndex];

  function handleSelect(optionIndex) {
    if (submitted) return;
    setSelectedAnswers({ ...selectedAnswers, [currentIndex]: optionIndex });
  }

  function handleNext() {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }

  function handlePrev() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  }

  async function handleFinish() {
    // Calculate score
    let score = 0;
    questions.forEach((q, idx) => {
      if (selectedAnswers[idx] === q.correct) score++;
    });

    setSubmitted(true);

    if (score >= 4) {
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/chores/quiz-complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kidAddress: wallet.address, score }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Quiz submission failed');
        onSuccess();
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
  }

  let finalScore = 0;
  if (submitted) {
    questions.forEach((q, idx) => {
      if (selectedAnswers[idx] === q.correct) finalScore++;
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="bp-modal quiz-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>🧠 5-Question Brain Quiz</h3>
          <button type="button" className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        {!submitted ? (
          <div className="quiz-body">
            <div className="quiz-progress-bar">
              <span className="quiz-badge">
                Question {currentIndex + 1} of {questions.length}
              </span>
              <span className="quiz-rule">Score 4/5 or 5/5 to earn +2 ⚡ Energy</span>
            </div>

            <div className="question-box">
              <div className="question-cat">{currentQ.category}</div>
              <h4 className="question-text">{currentQ.q}</h4>
            </div>

            <div className="options-grid">
              {currentQ.options.map((opt, optIdx) => {
                const isSelected = selectedAnswers[currentIndex] === optIdx;
                return (
                  <button
                    key={optIdx}
                    type="button"
                    className={`quiz-opt-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelect(optIdx)}
                  >
                    <span className="opt-letter">{['A', 'B', 'C', 'D'][optIdx]}</span>
                    <span className="opt-text">{opt}</span>
                  </button>
                );
              })}
            </div>

            <div className="quiz-nav">
              <button
                type="button"
                className="btn-prev"
                onClick={handlePrev}
                disabled={currentIndex === 0}
              >
                ← Back
              </button>

              {currentIndex < questions.length - 1 ? (
                <button
                  type="button"
                  className="btn-next"
                  onClick={handleNext}
                  disabled={selectedAnswers[currentIndex] === undefined}
                >
                  Next →
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-finish-quiz"
                  onClick={handleFinish}
                  disabled={Object.keys(selectedAnswers).length < questions.length || loading}
                >
                  {loading ? 'Submitting…' : 'Submit Quiz 🚀'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="quiz-result">
            {finalScore >= 4 ? (
              <div className="result-pass">
                <div className="result-icon">🏆</div>
                <h3>Quiz Passed!</h3>
                <p>
                  You scored{' '}
                  <strong>
                    {finalScore} / {questions.length}
                  </strong>
                  !
                </p>
                <div className="energy-reward-badge">+2 ⚡ Arena Energy Unlocked</div>
              </div>
            ) : (
              <div className="result-fail">
                <div className="result-icon">💪</div>
                <h3>Nice Try!</h3>
                <p>
                  You scored{' '}
                  <strong>
                    {finalScore} / {questions.length}
                  </strong>{' '}
                  (need 4 to pass).
                </p>
                <p>Try again or complete a real-world chore to earn Energy!</p>
                <button
                  type="button"
                  className="btn-retry"
                  onClick={() => {
                    setSelectedAnswers({});
                    setCurrentIndex(0);
                    setSubmitted(false);
                  }}
                >
                  Retry Quiz
                </button>
              </div>
            )}
            {error && <div className="quiz-error">{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
