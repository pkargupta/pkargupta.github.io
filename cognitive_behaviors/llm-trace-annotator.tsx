import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Download, Trash2 } from 'lucide-react';

// Sample reasoning traces data
const SAMPLE_DATA = [
  {
    id: "trace_001",
    question: "What is the capital of France?",
    reasoning: "Let me think about this question. France is a country in Europe. The capital city is where the government is located. Paris is the largest city in France and serves as its capital. Therefore, the answer is Paris."
  },
  {
    id: "trace_002",
    question: "If a train travels 120 miles in 2 hours, what is its average speed?",
    reasoning: "To find average speed, I need to divide distance by time. The train traveled 120 miles in 2 hours. So the calculation is 120 ÷ 2 = 60. The average speed is 60 miles per hour."
  },
  {
    id: "trace_003",
    question: "What are the primary colors?",
    reasoning: "Primary colors are the base colors that cannot be created by mixing other colors. In traditional color theory, the primary colors are red, yellow, and blue. These three colors can be mixed to create all other colors on the color wheel."
  }
];

const COGNITIVE_BEHAVIORS = [
  "Logical reasoning",
  "Pattern recognition",
  "Memory recall",
  "Causal inference",
  "Hypothesis generation",
  "Error detection",
  "Analogical thinking",
  "Decomposition"
];

export default function LLMTraceAnnotator() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [annotations, setAnnotations] = useState({});
  const [selectedText, setSelectedText] = useState('');
  const [selectionRange, setSelectionRange] = useState(null);
  const [selectedBehavior, setSelectedBehavior] = useState(COGNITIVE_BEHAVIORS[0]);
  const [selectedScore, setSelectedScore] = useState(1);
  const [hoveredSpan, setHoveredSpan] = useState(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const [activeSpanId, setActiveSpanId] = useState(null);
  const textRef = useRef(null);

  const currentTrace = SAMPLE_DATA[currentIndex];

  useEffect(() => {
    setSelectedText('');
    setSelectionRange(null);
    setActiveSpanId(null);
    setHoveredSpan(null);
  }, [currentIndex]);

  const handleTextSelection = () => {
    const selection = window.getSelection();
    const text = selection.toString().trim();
    
    if (text && textRef.current && textRef.current.contains(selection.anchorNode)) {
      setSelectedText(text);
      const range = selection.getRangeAt(0);
      setSelectionRange({
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        startContainer: range.startContainer,
        endContainer: range.endContainer
      });
    }
  };

  const handleSubmit = () => {
    if (!selectedText || !selectionRange) return;

    const newAnnotations = { ...annotations };
    if (!newAnnotations[currentTrace.id]) {
      newAnnotations[currentTrace.id] = { spans: [] };
    }

    const spanData = {
      text: selectedText,
      behavior: selectedBehavior,
      score: selectedScore,
      id: Date.now()
    };

    newAnnotations[currentTrace.id].spans.push(spanData);
    setAnnotations(newAnnotations);
    
    setSelectedText('');
    setSelectionRange(null);
    window.getSelection().removeAllRanges();
  };

  const handleDelete = (spanId) => {
    const newAnnotations = { ...annotations };
    if (newAnnotations[currentTrace.id]) {
      newAnnotations[currentTrace.id].spans = newAnnotations[currentTrace.id].spans.filter(
        span => span.id !== spanId
      );
    }
    setAnnotations(newAnnotations);
    setHoveredSpan(null);
    setActiveSpanId(null);
  };

  const downloadAnnotations = () => {
    const exportData = {};
    Object.keys(annotations).forEach(traceId => {
      exportData[traceId] = {
        spans: annotations[traceId].spans.map(span => [
          span.text,
          span.behavior,
          span.score
        ])
      };
    });

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'annotations.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const getHighlightedText = () => {
    const currentSpans = annotations[currentTrace.id]?.spans || [];
    if (currentSpans.length === 0) {
      return currentTrace.reasoning;
    }

    const text = currentTrace.reasoning;
    const textLength = text.length;
    
    // Create an array to track highlight status for each character
    // 0 = no highlight, 1 = yellow highlight, 2 = orange highlight
    const charHighlight = Array(textLength).fill(0);
    
    // First pass: mark all annotated text as yellow (1)
    currentSpans.forEach((span) => {
      let searchStart = 0;
      let foundIndex = text.indexOf(span.text, searchStart);
      
      while (foundIndex !== -1) {
        for (let i = foundIndex; i < foundIndex + span.text.length; i++) {
          charHighlight[i] = 1;
        }
        searchStart = foundIndex + 1;
        foundIndex = text.indexOf(span.text, searchStart);
      }
    });
    
    // Second pass: mark active span as orange (2)
    if (activeSpanId) {
      const activeSpan = currentSpans.find(s => s.id === activeSpanId);
      if (activeSpan) {
        let searchStart = 0;
        let foundIndex = text.indexOf(activeSpan.text, searchStart);
        
        while (foundIndex !== -1) {
          for (let i = foundIndex; i < foundIndex + activeSpan.text.length; i++) {
            charHighlight[i] = 2;
          }
          searchStart = foundIndex + 1;
          foundIndex = text.indexOf(activeSpan.text, searchStart);
        }
      }
    }
    
    // Build segments based on highlight changes
    const segments = [];
    let currentIndex = 0;
    
    while (currentIndex < textLength) {
      const currentHighlight = charHighlight[currentIndex];
      
      // Find where this highlight type ends
      let endIndex = currentIndex + 1;
      while (endIndex < textLength && charHighlight[endIndex] === currentHighlight) {
        endIndex++;
      }
      
      const segmentText = text.slice(currentIndex, endIndex);
      
      if (currentHighlight === 0) {
        segments.push({
          text: segmentText,
          isHighlight: false
        });
      } else {
        segments.push({
          text: segmentText,
          isHighlight: true,
          isActive: currentHighlight === 2
        });
      }
      
      currentIndex = endIndex;
    }
    
    return segments;
  };

  const segments = getHighlightedText();

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-gray-800">LLM Reasoning Trace Annotator</h1>
            <button
              onClick={downloadAnnotations}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
            >
              <Download size={20} />
              Download Annotations
            </button>
          </div>

          <div className="mb-6 p-4 bg-gray-100 rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                disabled={currentIndex === 0}
                className="p-2 rounded-lg bg-white hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft size={24} />
              </button>
              <span className="text-lg font-semibold">
                Question {currentIndex + 1} of {SAMPLE_DATA.length}
              </span>
              <button
                onClick={() => setCurrentIndex(Math.min(SAMPLE_DATA.length - 1, currentIndex + 1))}
                disabled={currentIndex === SAMPLE_DATA.length - 1}
                className="p-2 rounded-lg bg-white hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <ChevronRight size={24} />
              </button>
            </div>
            <div className="text-sm text-gray-600 mb-2">ID: {currentTrace.id}</div>
            <div className="font-semibold text-gray-800">{currentTrace.question}</div>
          </div>

          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg relative">
            <h3 className="font-semibold mb-2 text-gray-700">Reasoning Trace:</h3>
            <div
              ref={textRef}
              onMouseUp={handleTextSelection}
              className="text-gray-800 leading-relaxed select-text cursor-text relative"
            >
              {typeof segments === 'string' ? (
                segments
              ) : (
                segments.map((segment, idx) => (
                  segment.isHighlight ? (
                    <span
                      key={idx}
                      className={`relative cursor-pointer ${
                        segment.isActive 
                          ? 'bg-orange-300' 
                          : 'bg-yellow-300'
                      }`}
                      onMouseEnter={(e) => {
                        setHoverPosition({ x: e.clientX, y: e.clientY });
                      }}
                    >
                      {segment.text}
                    </span>
                  ) : (
                    <span key={idx}>{segment.text}</span>
                  )
                ))
              )}
            </div>
          </div>

          {hoveredSpan && (
            <div
              className="fixed bg-white border-2 border-gray-300 rounded-lg shadow-xl p-4 z-50"
              style={{
                left: `${hoverPosition.x + 10}px`,
                top: `${hoverPosition.y + 10}px`,
                maxWidth: '300px'
              }}
            >
              <div className="text-sm mb-2">
                <strong>Behavior:</strong> {hoveredSpan.behavior}
              </div>
              <div className="text-sm mb-3">
                <strong>Score:</strong> {hoveredSpan.score}
              </div>
              <button
                onClick={() => handleDelete(hoveredSpan.id)}
                className="flex items-center gap-2 bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 transition text-sm"
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          )}

          <div className="border-t pt-6">
            <h3 className="font-semibold mb-4 text-gray-700">Annotate Selection</h3>
            
            {selectedText && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="text-sm text-gray-600 mb-1">Selected text:</div>
                <div className="font-medium text-gray-800">"{selectedText}"</div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Cognitive Behavior:
                </label>
                <select
                  value={selectedBehavior}
                  onChange={(e) => setSelectedBehavior(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {COGNITIVE_BEHAVIORS.map(behavior => (
                    <option key={behavior} value={behavior}>{behavior}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Score:
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="score"
                      value="1"
                      checked={selectedScore === 1}
                      onChange={() => setSelectedScore(1)}
                      className="mr-2"
                    />
                    <span className="text-gray-700">1</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="score"
                      value="2"
                      checked={selectedScore === 2}
                      onChange={() => setSelectedScore(2)}
                      className="mr-2"
                    />
                    <span className="text-gray-700">2</span>
                  </label>
                </div>
              </div>

              <div className="flex items-end">
                <button
                  onClick={handleSubmit}
                  disabled={!selectedText}
                  className="w-full bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition font-medium"
                >
                  Submit Annotation
                </button>
              </div>
            </div>

            <div className="mt-6">
              <h4 className="font-semibold text-gray-700 mb-2">
                Current Annotations ({annotations[currentTrace.id]?.spans?.length || 0})
              </h4>
              {annotations[currentTrace.id]?.spans?.length > 0 ? (
                <div className="space-y-2">
                  {annotations[currentTrace.id].spans.map((span, idx) => (
                    <div 
                      key={span.id} 
                      className={`p-3 rounded-lg border cursor-pointer transition ${
                        activeSpanId === span.id 
                          ? 'bg-orange-100 border-orange-400' 
                          : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }`}
                      onClick={() => {
                        if (activeSpanId === span.id) {
                          setActiveSpanId(null);
                          setHoveredSpan(null);
                        } else {
                          setActiveSpanId(span.id);
                          setHoveredSpan(span);
                        }
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="text-sm">
                            <strong>Text:</strong> "{span.text}"
                          </div>
                          <div className="text-sm">
                            <strong>Behavior:</strong> {span.behavior}
                          </div>
                          <div className="text-sm">
                            <strong>Score:</strong> {span.score}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(span.id);
                          }}
                          className="ml-3 p-2 text-red-600 hover:bg-red-100 rounded transition"
                          title="Delete annotation"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-500 italic">No annotations yet for this trace.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}