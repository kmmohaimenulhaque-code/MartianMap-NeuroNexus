import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

function MarsTerrain() {
  const { scene } = useGLTF('/assets/mola_test_region.glb')

  scene.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true
      object.receiveShadow = true

      object.material = new THREE.MeshStandardMaterial({
        color: '#8f6b55',
        roughness: 0.95,
        metalness: 0.0,
        side: THREE.DoubleSide,
      })
    }
  })

  return (
    <primitive
      object={scene}
      scale={0.001}
      rotation={[0, 0, 0]}
    />
  )
}

useGLTF.preload('/assets/mola_test_region.glb')

export default function App() {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#050505',
      }}
    >
      <Canvas
        camera={{
          position: [0, 0, 8],
          fov: 45,
          near: 0.01,
          far: 100,
        }}
      >
        <ambientLight intensity={1.5} />

        <directionalLight
          position={[5, 5, 5]}
          intensity={3}
        />

        <MarsTerrain />

        <OrbitControls
          enableDamping
          minDistance={0.1}
          maxDistance={50}
        />

        <gridHelper
          args={[10, 10]}
          position={[0, 0, 0]}
        />
      </Canvas>
    </div>
  )
}
