import './App.css'
import Viewer from './components/Viewer'
import type { Rectangle } from './types';


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


  return (
    <>
      <h1>Webworker Rendering Example</h1>
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div>
          <h3>800 x 600</h3>
          <Viewer width={800} height={600} image={image} onFetchData={handleFetchData}/>
        </div>
      </div>
    </>
  )
}

export default App
