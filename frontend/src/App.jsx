import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense } from "react";

function MarsTerrain() {
  const { scene } = useGLTF("/assets/mars_terrain.glb");

  return (
    <primitive
      object={scene}
      scale={0.001}
    />
  );
}

function App() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Canvas
        camera={{
          position: [0, 2, 7],
          fov: 45,
          near: 0.001,
          far: 1000,
        }}
      >
        <color attach="background" args={["#050505"]} />

        <ambientLight intensity={1.2} />

        <directionalLight
          position={[5, 5, 5]}
          intensity={3}
        />

        <Suspense fallback={null}>
          <MarsTerrain />
        </Suspense>

        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          minDistance={1}
          maxDistance={20}
        />
      </Canvas>
    </div>
  );
}

export default App;
