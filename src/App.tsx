import React from 'react';
import './App.css'
import Viewer from './components/Viewer'
import type { Rectangle } from './types';
import { ViewerTwo } from './components/ViewerTwo';

const image = {
  width: 10_000,
  height: 10_000,
};

function App() {
  const handleFetchData = async (area: Rectangle) => {
    console.log('Fetching data for area:', area);
    // Simulate a network request
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        console.log('Data fetched for area:', area);
        resolve();
      }, 1000);
    });
  };

  const [viewerType, setviewerType] = React.useState(1);

  return (
    <>
      <h1>Webworker Rendering Example</h1>
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div>
          <h3>800 x 600</h3>
          {viewerType == 1 && <Viewer width={800} height={600} image={image} onFetchData={handleFetchData}/>}
          {viewerType == 2 && <ViewerTwo width={800} height={600} image={image} onFetchData={handleFetchData}/>}
        </div>
      </div>

      <input type="radio" id="viewer1" value="1" checked={viewerType === 1} onChange={() => setviewerType(1)} />
      <label htmlFor='viewer1'>Viewer with web worker</label>
      <input type="radio" id="viewer2" value="2" checked={viewerType === 2} onChange={() => setviewerType(2)} />
      <label htmlFor='viewer2'>Viewer without web worker</label>
    </>
  )
}

export default App
