import {runAnalysis} from './engine.js';

self.onmessage = ({data: {id, type, dataset, params}}) => {
  self.postMessage({id, progress: 0.1});
  try {
    const result = runAnalysis({type, dataset, params});
    self.postMessage({id, progress: 1, result});
  } catch (error) {
    self.postMessage({id, error: error.message || String(error)});
  }
};
