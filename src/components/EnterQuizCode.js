import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import * as faceapi from 'face-api.js';

export default function EnterQuizCode() {
  const [quizCode, setQuizCode] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [error, setError] = useState('');
  const [quizData, setQuizData] = useState(null);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [proctoringError, setProctoringError] = useState('');
  const [tabSwitchWarning, setTabSwitchWarning] = useState('');
  const videoRef = useRef(null);
  const navigate = useNavigate();
  const detectionIntervalRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const streamRef = useRef(null);
  const warningTimeoutRef = useRef(null); // Reference to the warning timeout

  // Timer formatting
  const formatTime = (time) => {
    const minutes = Math.floor(time / 60);
    const seconds = time % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  useEffect(() => {
    const loadModels = async () => {
      try {
        await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
        await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
        console.log("Face detection models loaded");
      } catch (error) {
        console.error('Error loading models:', error);
      }
    };
    loadModels();
  
    // Listen for tab visibility changes
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setTabSwitchWarning('You have switched the tab. Please return to the quiz.');
        clearTimeout(warningTimeoutRef.current);
        warningTimeoutRef.current = setTimeout(() => {
          setTabSwitchWarning('');
        }, 10000);
      }
    };

    // Listen for window focus/blur events
    const handleWindowBlur = () => {
      setTabSwitchWarning('You have switched the window or minimized the tab. Please return to the quiz.');
      clearTimeout(warningTimeoutRef.current);
      warningTimeoutRef.current = setTimeout(() => {
        setTabSwitchWarning('');
      }, 10000);
    };

    const handleWindowFocus = () => {
      clearTimeout(warningTimeoutRef.current);
      warningTimeoutRef.current = setTimeout(() => {
        setTabSwitchWarning('');
      }, 10000);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      stopWebcam();
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      clearTimeout(warningTimeoutRef.current); // Cleanup warning timeout

      // Clean up event listeners
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, []);
  
  const startProctoring = () => {
    const detectFace = async () => {
      if (videoRef.current) {
        const detections = await faceapi.detectAllFaces(videoRef.current, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks();
        
        if (!detections.length) {
          setProctoringError('No face detected. Please stay in front of the camera.');
        } else if (detections.length > 1) {
          setProctoringError('Multiple faces detected! This is a violation.');
        } else {
          setProctoringError('');
          const landmarks = detections[0].landmarks;

          // Detect head turn (left/right)
          const nose = landmarks.getNose();
          const leftEye = landmarks.getLeftEye();
          const rightEye = landmarks.getRightEye();

          const noseX = nose[3].x; // Center of the nose
          const leftEyeX = leftEye[0].x; // Leftmost point of left eye
          const rightEyeX = rightEye[3].x; // Rightmost point of right eye

          const eyeDistance = rightEyeX - leftEyeX;
          const noseToLeftEyeDistance = noseX - leftEyeX;

          if (noseToLeftEyeDistance / eyeDistance > 0.6) {
            setProctoringError('Head turned left.');
          } else if (noseToLeftEyeDistance / eyeDistance < 0.4) {
            setProctoringError('Head turned right.');
          } else {
            setProctoringError('');
          }
        }
      }
    };

    detectionIntervalRef.current = setInterval(detectFace, 5000); // Detect face every 5 seconds
  };

  const startTimer = () => {
    timerIntervalRef.current = setInterval(() => {
      setTimeLeft((prevTime) => {
        if (prevTime <= 1) {
          clearInterval(timerIntervalRef.current);
          handleSubmitAnswers();
          return 0;
        }
        return prevTime - 1;
      });
    }, 1000);
  };

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoRef.current.srcObject = stream;
      streamRef.current = stream;
      videoRef.current.play();
    } catch (error) {
      console.error('Error accessing webcam:', error);
    }
  };

  const stopWebcam = () => {
    if (streamRef.current) {
      const tracks = streamRef.current.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
      streamRef.current = null;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const quizQuery = query(collection(db, 'created_quiz'), where('quizCode', '==', quizCode));
      const querySnapshot = await getDocs(quizQuery);

      if (!querySnapshot.empty) {
        const quizDoc = querySnapshot.docs[0];
        const data = quizDoc.data();

        if (data.accessKey !== accessKey) {
          setError('Invalid access key. Please try again.');
          setQuizData(null);
          return;
        }

        const currentDate = new Date();
        const startDateTime = new Date(`${data.startDate}T${data.startTime}`);
        const endDateTime = new Date(`${data.endDate}T${data.endTime}`);

        if (currentDate >= startDateTime && currentDate <= endDateTime) {
          setQuizData(data);
          setError('');
          setSubmitted(false);
          setTimeLeft(data.quizDuration * 60);
          startWebcam();
          startProctoring();
          startTimer();
        } else if (currentDate < startDateTime) {
          setError('The quiz has not started yet. Please try again later.');
          setQuizData(null);
        } else {
          setError('The quiz has ended. Please contact your instructor for more information.');
          setQuizData(null);
        }
      } else {
        setError('Invalid quiz code. Please try again.');
        setQuizData(null);
      }
    } catch (error) {
      console.error('Error fetching quiz:', error);
      setError('An error occurred. Please try again.');
    }
  };

  const handleOptionChange = (qIndex, option) => {
    setSelectedAnswers({ ...selectedAnswers, [qIndex]: option });
  };

  const handleSubmitAnswers = () => {
    if (quizData) {
      let calculatedScore = 0;
      quizData.questions.forEach((q, qIndex) => {
        if (selectedAnswers[qIndex] === q.answer) {
          calculatedScore += 1;
        }
      });
      setScore(calculatedScore);
      setSubmitted(true);

      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }

      stopWebcam();

      navigate('/result', { state: { score: calculatedScore, total: quizData.questions.length } });
    }
  };

  return (
    <div className="flex justify-center items-center h-screen bg-gray-100 relative">
      <div className="w-full max-w-lg bg-white p-8 rounded-lg shadow-lg">
        <h2 className="text-3xl font-bold text-center mb-6 text-blue-600">Quiz Attendance</h2>
        <h3 className="text-lg text-center mb-4 text-gray-700">Enter Quiz Code and Access Key</h3>
        
        {!quizData ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="quizCode" className="block text-gray-600 font-semibold">Quiz Code</label>
              <input
                type="text"
                id="quizCode"
                value={quizCode}
                onChange={(e) => setQuizCode(e.target.value)}
                required
                className="mt-1 p-2 border border-gray-300 rounded w-full"
              />
            </div>
            <div>
              <label htmlFor="accessKey" className="block text-gray-600 font-semibold">Access Key</label>
              <input
                type="password"
                id="accessKey"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                required
                className="mt-1 p-2 border border-gray-300 rounded w-full"
              />
            </div>
            {error && <p className="text-red-600 text-center">{error}</p>}
            <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-500 transition duration-200">Start Quiz</button>
          </form>
        ) : submitted ? (
          <div className="text-center">
            <h4 className="text-xl font-semibold">Your Score: {score}/{quizData.questions.length}</h4>
            <button onClick={() => navigate('/')} className="mt-4 bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-500 transition duration-200">Go to Home</button>
          </div>
        ) : (
          <div>
            <h4 className="text-xl font-semibold mb-4">You have {formatTime(timeLeft)} left to complete the quiz.</h4>
            {quizData.questions.map((question, qIndex) => (
              <div key={qIndex} className="mb-4 p-4 border rounded bg-gray-50">
                <h5 className="font-medium">{question.text}</h5>
                {question.options.map((option, index) => (
                  <label key={index} className="block mt-2">
                    <input
                      type="radio"
                      name={`question-${qIndex}`}
                      value={option}
                      onChange={() => handleOptionChange(qIndex, option)}
                      className="mr-2"
                    />
                    {option}
                  </label>
                ))}
              </div>
            ))}
            {tabSwitchWarning && <p className="text-red-600 text-center">{tabSwitchWarning}</p>}
            {proctoringError && <p className="text-red-600 text-center">{proctoringError}</p>}
            <button onClick={handleSubmitAnswers} className="w-full mt-4 bg-green-600 text-white py-2 rounded hover:bg-green-500 transition duration-200">Submit Answers</button>
          </div>
        )}
        
        <div className="absolute top-7 right-5">
  <video ref={videoRef} className="w-48 h-48 rounded-lg border-2 border-blue-600" autoPlay muted></video>
</div>

      </div>
    </div>
  );
}