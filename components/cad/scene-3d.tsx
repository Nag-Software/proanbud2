"use client"

/**
 * 3D-visningen.
 *
 * Bygger på react-three-fiber (three.js). Bevisste valg:
 *  - INGEN eksterne assets: ingen HDRI fra CDN, ingen fontfiler. Lyssettingen
 *    er håndsatt (retningslys med myke skygger + himmel/bakke-lys), slik at
 *    scenen laster øyeblikkelig, virker offline og ikke brytes av CSP.
 *  - Geometrien kommer fra den samme `buildStoreySolids` som IFC-eksporten.
 *    Det brukeren ser er det mottakeren får.
 *  - Du kan dra en vegg rett i 3D: den glir langs sin egen normal, med
 *    rutenettsnapp, akkurat som i plantegningen.
 */

import * as React from "react"
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber"
import {
  ContactShadows,
  Edges,
  GizmoHelper,
  GizmoViewport,
  Grid,
  OrbitControls,
} from "@react-three/drei"
import * as THREE from "three"

import { buildStoreySolids, modelBounds, pointOnWall, worldFromPlan } from "@/lib/cad/geometry"
import { normalize, perpendicular, sub } from "@/lib/cad/math"
import { ELEMENT_COLORS } from "@/lib/cad/presets"
import type { CadStore } from "@/lib/cad/store"
import { useCadState } from "@/lib/cad/store"
import type { BuildingModel, ElementSolid, SelectionRef, Storey } from "@/lib/cad/types"
import { cn } from "@/lib/utils"

type SolidEntry = { storey: Storey; solid: ElementSolid }

export function Scene3D({ store, className }: { store: CadStore; className?: string }) {
  const state = useCadState(store)

  /**
   * Startkameraet regnes ÉN gang.
   *
   * Tidligere fulgte både kameraposisjonen og OrbitControls-målet modellens
   * bounds, som regnes på nytt ved hver eneste endring. En rotasjon flyttet
   * dermed både mål og kamera midt i bevegelsen, og bygget forsvant ut av
   * bildet. Nå eier brukeren kameraet; «Sentrer» rammer inn på kommando.
   */
  const [initialView] = React.useState<{
    position: [number, number, number]
    target: [number, number, number]
  }>(() => {
    const bounds = modelBounds(state.model)
    const radius = Math.max(bounds.width, bounds.height, 8)
    return {
      position: [bounds.center.x + radius * 0.9, radius * 0.8, -bounds.center.y + radius * 1.1],
      target: [bounds.center.x, 1.2, -bounds.center.y],
    }
  })

  const fitViewRef = React.useRef<(() => void) | null>(null)

  return (
    <div className={cn("relative h-full w-full bg-gradient-to-b from-sky-50 to-slate-100 dark:from-slate-900 dark:to-slate-950", className)}>
      <Canvas
        // VSM er den eneste skyggetypen i three 0.185 som gir ekte myk kant
        // (shadow-radius). drei sin SoftShadows kan IKKE brukes her: den
        // patcher inn `unpackRGBAToDepth`, som er fjernet i denne versjonen, og
        // da feiler alle MeshStandardMaterial å kompilere — modellen blir stående
        // som ren trådramme.
        shadows="variance"
        dpr={[1, 2]}
        gl={{
          antialias: true,
          preserveDrawingBuffer: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
        }}
        camera={{
          position: initialView.position,
          fov: 45,
          near: 0.05,
          // Fast, romslig klippeplan i stedet for et som skalerer med modellen —
          // da slipper vi at kameraet må røres når bygget vokser.
          far: 4000,
        }}
        onPointerMissed={() => store.setSelection(null)}
      >
        <SceneContents
          store={store}
          initialTarget={initialView.target}
          fitViewRef={fitViewRef}
        />
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 rounded-md border bg-background/80 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
        Dra i en vegg for å flytte den · rull for å zoome · høyreklikk for å panorere
      </div>

      <button
        type="button"
        onClick={() => fitViewRef.current?.()}
        className="absolute bottom-3 left-3 rounded-md border bg-background/90 px-2.5 py-1.5 text-xs font-medium backdrop-blur hover:bg-accent"
      >
        Sentrer
      </button>
    </div>
  )
}

function SceneContents({
  store,
  initialTarget,
  fitViewRef,
}: {
  store: CadStore
  initialTarget: [number, number, number]
  fitViewRef: React.RefObject<(() => void) | null>
}) {
  const state = useCadState(store)
  const { camera } = useThree()
  const bounds = React.useMemo(() => modelBounds(state.model), [state.model])
  const controlsRef = React.useRef<{ target: THREE.Vector3; update: () => void } | null>(null)

  /**
   * Rutenett, skyggekamera og lys holdes på en FAST skala.
   *
   * Lot vi dem følge modellens bounds, ble hele rutenettet og skyggekartet
   * bygget om for hver minste endring — synlig blafring mens man drar i en
   * vegg. En romslig fast skala dekker et vanlig småhusprosjekt uten å røre
   * seg.
   */
  const [radius] = React.useState(() => {
    const bounds = modelBounds(state.model)
    return Math.max(bounds.width, bounds.height, 30)
  })

  /**
   * Rammer inn bygget på kommando. Effekten bytter bare ut en closure når
   * modellen endrer seg — den rører aldri kameraet av seg selv. Det er
   * forskjellen fra før, da kameraet ble flyttet ved hver endring.
   */
  React.useEffect(() => {
    fitViewRef.current = () => {
      const current = modelBounds(state.model)
      const span = Math.max(current.width, current.height, 8)
      camera.position.set(
        current.center.x + span * 0.9,
        span * 0.8,
        -current.center.y + span * 1.1
      )
      const controls = controlsRef.current
      if (controls) {
        controls.target.set(current.center.x, 1.2, -current.center.y)
        controls.update()
      }
      camera.updateProjectionMatrix()
    }
    return () => {
      fitViewRef.current = null
    }
  }, [camera, fitViewRef, state.model])

  /**
   * Ett unntak fra «kameraet står stille»: første gang etasjen får geometri.
   * Startkameraet ble satt mens modellen var tom, og da peker det ingen steder.
   */
  const hasGeometry = React.useMemo(
    () =>
      state.model.storeys.some(
        (storey) =>
          storey.walls.length > 0 || storey.slabs.length > 0 || storey.roofs.length > 0
      ),
    [state.model]
  )
  const wasEmpty = React.useRef(!hasGeometry)
  React.useEffect(() => {
    if (wasEmpty.current && hasGeometry) fitViewRef.current?.()
    wasEmpty.current = !hasGeometry
  }, [fitViewRef, hasGeometry])

  const visibleStoreys = React.useMemo(
    () =>
      state.showAllStoreys
        ? state.model.storeys
        : state.model.storeys.filter((storey) => storey.id === state.activeStoreyId),
    [state.activeStoreyId, state.model.storeys, state.showAllStoreys]
  )

  // Mens en vegg dras må kamerastyringen stå stille, ellers roterer scenen
  // samtidig. Vi styrer det med React-state og `enabled`-propen i stedet for å
  // skru på controls-objektet direkte — det er objektet r3f eier.
  const [draggingWall, setDraggingWall] = React.useState(false)

  const entries = React.useMemo<SolidEntry[]>(() => {
    const result: SolidEntry[] = []
    for (const storey of visibleStoreys) {
      for (const solid of buildStoreySolids(storey).solids) {
        result.push({ storey, solid })
      }
    }
    return result
  }, [visibleStoreys])

  return (
    <>
      <color attach="background" args={["#e9eef5"]} />
      <fog attach="fog" args={["#e9eef5", radius * 3, radius * 9]} />

      {/* Himmel- og bakkelys gir farget omgivelseslys: kjølig ovenfra, varmt
          reflektert nedenfra, slik dagslys faktisk oppfører seg. */}
      <hemisphereLight args={["#cfe3ff", "#c9bda8", 1.25]} />
      <directionalLight
        castShadow
        position={[radius * 0.7, radius * 1.3, radius * 0.55]}
        intensity={2.4}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={6}
        shadow-blurSamples={16}
      >
        <orthographicCamera
          attach="shadow-camera"
          args={[-radius * 1.2, radius * 1.2, radius * 1.2, -radius * 1.2, 0.1, radius * 6]}
        />
      </directionalLight>
      {/* Utfyllingslys fra motsatt side, så skyggesidene ikke blir døde. */}
      <directionalLight position={[-radius, radius * 0.5, -radius * 0.8]} intensity={0.45} />
      {/* Svakt motlys som tegner opp kantene mot bakgrunnen. */}
      <directionalLight position={[0, radius * 0.3, -radius * 1.4]} intensity={0.25} />

      {/* Bakkeplan som tar imot skygge. Uten det henger bygget i løse lufta. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[initialTarget[0], -0.02, initialTarget[2]]}
        receiveShadow
      >
        <planeGeometry args={[radius * 8, radius * 8]} />
        <meshStandardMaterial color="#dfe4ea" roughness={1} metalness={0} />
      </mesh>

      <Grid
        position={[initialTarget[0], -0.01, initialTarget[2]]}
        args={[radius * 4, radius * 4]}
        cellSize={1}
        cellThickness={0.6}
        cellColor="#c3cbd6"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#93a1b3"
        fadeDistance={radius * 6}
        fadeStrength={1}
        infiniteGrid={false}
        followCamera={false}
      />

      <ContactShadows
        position={[bounds.center.x, 0.001, -bounds.center.y]}
        key="contact-shadows"
        scale={radius * 3}
        opacity={0.35}
        blur={2.2}
        far={radius}
      />

      {entries.map(({ storey, solid }) => (
        <SolidMeshView
          key={`${storey.id}:${solid.id}`}
          store={store}
          storey={storey}
          solid={solid}
          model={state.model}
          selection={state.selection}
          onDragChange={setDraggingWall}
        />
      ))}

      <OrbitControls
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={controlsRef as any}
        makeDefault
        enabled={!draggingWall}
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.05}
        // `target` settes kun ved montering. Som prop ville den blitt skrevet
        // tilbake ved hver render og overstyrt brukerens egen panorering.
        target={initialTarget}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />

      <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
        <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3b82f6"]} labelColor="#1f2937" />
      </GizmoHelper>
    </>
  )
}

function SolidMeshView({
  store,
  storey,
  solid,
  model,
  selection,
  onDragChange,
}: {
  store: CadStore
  storey: Storey
  solid: ElementSolid
  model: BuildingModel
  selection: SelectionRef | null
  onDragChange: (dragging: boolean) => void
}) {
  const { camera, raycaster, gl } = useThree()
  const [hovered, setHovered] = React.useState(false)
  const opening =
    solid.elementKind === "opening"
      ? storey.walls.flatMap((wall) => wall.openings).find((candidate) => candidate.id === solid.elementId)
      : undefined

  const geometry = React.useMemo(() => {
    const buffer = new THREE.BufferGeometry()
    buffer.setAttribute("position", new THREE.Float32BufferAttribute(solid.mesh.positions, 3))
    buffer.setIndex(solid.mesh.indices)
    buffer.computeVertexNormals()
    return buffer
  }, [solid.mesh])

  React.useEffect(() => () => geometry.dispose(), [geometry])

  const appearance = React.useMemo(
    () => resolveAppearance(solid, storey, model),
    [model, solid, storey]
  )

  const isSelected =
    selection?.kind === appearanceKind(solid) && selection.id === solid.elementId

  const wall =
    solid.elementKind === "wall"
      ? storey.walls.find((item) => item.id === solid.elementId)
      : undefined

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()

    const selectionRef = selectionFor(solid, storey)
    if (selectionRef) store.setSelection(selectionRef)

    if (!wall || wall.locked || event.button !== 0) return

    // Dra i veggen: vi projiserer musa på et vannrett plan i veggens høyde og
    // lar bare bevegelsen LANGS veggnormalen telle. Da glir veggen sidelengs i
    // stedet for å bli slengt ut i rommet.
    const direction = normalize(sub(wall.b, wall.a))
    const wallNormal = new THREE.Vector2(
      perpendicular(direction).x,
      perpendicular(direction).y
    )
    const planeHeight = storey.elevation + wall.baseOffset + wall.height / 2
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeHeight)
    const previous = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(plane, previous)) return

    // OrbitControls lytter på canvas-elementet direkte, så r3f-ens
    // stopPropagation stopper den ikke. Uten dette ville kameraet rotert
    // samtidig som veggen flyttes.
    onDragChange(true)

    const canvas = gl.domElement

    const onMove = (moveEvent: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const pointer = new THREE.Vector2(
        ((moveEvent.clientX - rect.left) / rect.width) * 2 - 1,
        -((moveEvent.clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(pointer, camera)
      const current = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(plane, current)) return

      // three-akser tilbake til planet: x = x, y = -z
      const deltaPlan = new THREE.Vector2(current.x - previous.x, -(current.z - previous.z))
      const along = deltaPlan.dot(wallNormal)
      const gridSize = model.meta.gridSize || 0.1
      const snapped = Math.round(along / gridSize) * gridSize
      if (Math.abs(snapped) < 1e-9) return

      store.moveWall(
        wall.id,
        { x: wallNormal.x * snapped, y: wallNormal.y * snapped },
        { transient: true }
      )
      previous.copy(current)
    }

    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      onDragChange(false)
      store.commitTransient()
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  if (solid.elementKind === "opening" && wall && opening) {
    return (
      <OpeningVisual
        geometry={geometry}
        wall={wall}
        opening={opening}
        storey={storey}
        isSelected={isSelected}
        hovered={hovered}
        setHovered={setHovered}
        onPointerDown={handlePointerDown}
        materialColor={
          solid.materialId
            ? model.materials.find((item) => item.id === solid.materialId)?.color ?? null
            : null
        }
      />
    )
  }

  return (
    <mesh
      geometry={geometry}
      castShadow={appearance.castShadow}
      receiveShadow
      onPointerDown={handlePointerDown}
      onPointerOver={(event) => {
        event.stopPropagation()
        setHovered(true)
      }}
      onPointerOut={() => setHovered(false)}
    >
      <meshStandardMaterial
        color={isSelected ? ELEMENT_COLORS.selection : hovered ? ELEMENT_COLORS.hover : appearance.color}
        roughness={appearance.roughness}
        metalness={0.02}
        // Matte byggematerialer sprer lys bredt; litt flat skyggelegging
        // kler dem bedre enn den harde standardmodellen.
        flatShading={false}
        side={THREE.FrontSide}
        emissive={isSelected ? new THREE.Color(ELEMENT_COLORS.selection) : new THREE.Color("#000000")}
        emissiveIntensity={isSelected ? 0.18 : 0}
        transparent={appearance.transparent}
        opacity={appearance.transparent ? 0.2 : 1}
        depthWrite={!appearance.transparent}
      />
      {/* Mørk, tynn kantlinje langs de EKTE hjørnene (threshold filtrerer bort
          trekantkanter inne i flatene). Det er dette som får volumene til å
          leses som bygningsdeler i stedet for grå klumper. */}
      <Edges
        color={isSelected ? ELEMENT_COLORS.selection : "#4a5058"}
        threshold={18}
        scale={1.0008}
      />
    </mesh>
  )
}

function OpeningVisual({
  geometry,
  wall,
  opening,
  storey,
  isSelected,
  hovered,
  setHovered,
  onPointerDown,
  materialColor,
}: {
  geometry: THREE.BufferGeometry
  wall: Storey["walls"][number]
  opening: Storey["walls"][number]["openings"][number]
  storey: Storey
  isSelected: boolean
  hovered: boolean
  setHovered: React.Dispatch<React.SetStateAction<boolean>>
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void
  /** Fargen på varen som er lagt på åpningen, eller null når ingen er valgt. */
  materialColor: string | null
}) {
  const { hitGeometry, pieces } = React.useMemo(() => {
    const localDirection = normalize(sub(wall.b, wall.a))
    const worldDirection = new THREE.Vector3(localDirection.x, 0, -localDirection.y).normalize()
    const worldUp = new THREE.Vector3(0, 1, 0)
    const worldNormal = new THREE.Vector3().crossVectors(worldDirection, worldUp).normalize()
    const basis = new THREE.Matrix4().makeBasis(worldDirection, worldUp, worldNormal)
    const center = new THREE.Vector3(
      ...worldFromPlan(
        pointOnWall(wall, opening.distance),
        storey.elevation + wall.baseOffset + opening.sill + opening.height / 2
      )
    )
    basis.setPosition(center)

    const geometrySet: THREE.BufferGeometry[] = []
    const pushBox = (
      width: number,
      height: number,
      depth: number,
      offsetX = 0,
      offsetY = 0,
      offsetZ = 0
    ) => {
      if (width <= 0 || height <= 0 || depth <= 0) return
      const box = new THREE.BoxGeometry(width, height, depth)
      box.translate(offsetX, offsetY, offsetZ)
      box.applyMatrix4(basis)
      geometrySet.push(box)
    }

    const isWindow = opening.kind !== "door"
    const frameDepth = Math.min(Math.max(wall.thickness * 0.28, 0.06), 0.1)
    const sideFrame = Math.min(Math.max(opening.width * 0.08, 0.045), 0.08)
    const topFrame = Math.min(Math.max(opening.height * 0.08, 0.045), 0.08)
    const bottomFrame = isWindow ? Math.min(Math.max(opening.height * 0.06, 0.035), 0.06) : 0.03
    const innerWidth = Math.max(opening.width - sideFrame * 2, 0.02)
    const innerHeight = Math.max(opening.height - topFrame - bottomFrame, 0.02)
    const outerFaceZ = wall.thickness / 2 - frameDepth / 2
    const innerFaceZ = -wall.thickness / 2 + frameDepth / 2
    const centerZ = 0

    // Ytre og indre ramme gir dybde og skygger som leses bedre i 3D enn en flat boks.
    pushBox(sideFrame, opening.height, frameDepth, -opening.width / 2 + sideFrame / 2, 0, outerFaceZ)
    pushBox(sideFrame, opening.height, frameDepth, opening.width / 2 - sideFrame / 2, 0, outerFaceZ)
    pushBox(innerWidth, topFrame, frameDepth, 0, opening.height / 2 - topFrame / 2, outerFaceZ)
    if (bottomFrame > 0) {
      pushBox(innerWidth, bottomFrame, frameDepth, 0, -opening.height / 2 + bottomFrame / 2, outerFaceZ)
    }

    pushBox(sideFrame, opening.height, frameDepth, -opening.width / 2 + sideFrame / 2, 0, innerFaceZ)
    pushBox(sideFrame, opening.height, frameDepth, opening.width / 2 - sideFrame / 2, 0, innerFaceZ)
    pushBox(innerWidth, topFrame, frameDepth, 0, opening.height / 2 - topFrame / 2, innerFaceZ)
    if (bottomFrame > 0) {
      pushBox(innerWidth, bottomFrame, frameDepth, 0, -opening.height / 2 + bottomFrame / 2, innerFaceZ)
    }

    if (isWindow) {
      const glassDepth = Math.min(Math.max(wall.thickness * 0.08, 0.012), 0.03)
      const glassWidth = Math.max(innerWidth - 0.02, 0.01)
      const glassHeight = Math.max(innerHeight - 0.02, 0.01)
      pushBox(glassWidth, glassHeight, glassDepth, 0, (bottomFrame - topFrame) * 0.05, centerZ)

      // Vannbrett: en tynn, utstikkende hylle under vinduet. Liten detalj, men
      // det er slike kanter øyet bruker for å lese et vindu som et vindu.
      const sillDepth = wall.thickness * 0.5 + 0.04
      pushBox(
        opening.width + 0.08,
        0.03,
        sillDepth,
        0,
        -opening.height / 2 + 0.015,
        outerFaceZ - sillDepth * 0.25
      )
    } else {
      const leafWidth = Math.max(opening.width - 0.06, 0.02)
      const leafHeight = Math.max(opening.height - 0.07, 0.02)
      const leafDepth = Math.min(Math.max(wall.thickness * 0.18, 0.04), 0.07)
      pushBox(leafWidth, leafHeight, leafDepth, 0, -0.01, centerZ)
    }

    return { hitGeometry: geometry, pieces: geometrySet }
  }, [geometry, opening, storey.elevation, wall])

  React.useEffect(
    () => () => {
      hitGeometry.dispose()
      for (const piece of pieces) piece.dispose()
    },
    [hitGeometry, pieces]
  )

  const isWindow = opening.kind !== "door"

  // Karmen tar fargen fra varen brukeren har valgt. Uten valgt vare bruker vi
  // hvit karm på vindu (norsk standard — glasset har sitt eget materiale) og
  // trefarge på dør.
  const frameColor = materialColor ?? (isWindow ? "#f4f3f0" : ELEMENT_COLORS.door)

  return (
    <group
      onPointerDown={onPointerDown}
      onPointerOver={(event) => {
        event.stopPropagation()
        setHovered(true)
      }}
      onPointerOut={() => setHovered(false)}
    >
      <mesh geometry={hitGeometry} visible={false} />

      {pieces.map((piece, index) => {
        const glass = isWindow && index === pieces.length - 1
        const leaf = !isWindow && index === pieces.length - 1
        return (
          <mesh key={index} geometry={piece} castShadow receiveShadow>
            {glass ? (
              <meshPhysicalMaterial
                color={isSelected ? ELEMENT_COLORS.selection : "#b6d8ea"}
                transparent
                opacity={0.58}
                roughness={0.02}
                metalness={0}
                transmission={0.92}
                thickness={0.02}
                ior={1.45}
                clearcoat={1}
                clearcoatRoughness={0}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            ) : leaf ? (
              <meshPhysicalMaterial
                color={isSelected ? ELEMENT_COLORS.selection : hovered ? "#c28a57" : frameColor}
                roughness={0.55}
                metalness={0.02}
                clearcoat={0.16}
                clearcoatRoughness={0.22}
                side={THREE.FrontSide}
              />
            ) : (
              <meshStandardMaterial
                color={isSelected ? ELEMENT_COLORS.selection : hovered ? ELEMENT_COLORS.hover : frameColor}
                roughness={0.72}
                metalness={0.01}
                emissive={isSelected ? new THREE.Color(ELEMENT_COLORS.selection) : new THREE.Color("#000000")}
                emissiveIntensity={isSelected ? 0.12 : 0}
              />
            )}
            <Edges color={isSelected ? ELEMENT_COLORS.selection : "rgba(255,255,255,0.45)"} scale={1.001} />
          </mesh>
        )
      })}
    </group>
  )
}

function appearanceKind(solid: ElementSolid): SelectionRef["kind"] {
  return solid.elementKind === "space" ? "space" : solid.elementKind
}

function selectionFor(solid: ElementSolid, storey: Storey): SelectionRef | null {
  if (solid.elementKind === "wall") {
    return { kind: "wall", id: solid.elementId, storeyId: storey.id }
  }
  if (solid.elementKind === "opening") {
    const wall = storey.walls.find((candidate) =>
      candidate.openings.some((opening) => opening.id === solid.elementId)
    )
    if (!wall) return null
    return { kind: "opening", id: solid.elementId, wallId: wall.id, storeyId: storey.id }
  }
  if (solid.elementKind === "slab") return { kind: "slab", id: solid.elementId, storeyId: storey.id }
  if (solid.elementKind === "roof") return { kind: "roof", id: solid.elementId, storeyId: storey.id }
  if (solid.elementKind === "column") {
    return { kind: "column", id: solid.elementId, storeyId: storey.id }
  }
  return null
}

function resolveAppearance(solid: ElementSolid, storey: Storey, model: BuildingModel) {
  const material = solid.materialId
    ? model.materials.find((item) => item.id === solid.materialId)
    : undefined

  if (solid.elementKind === "roof") {
    return {
      color: material?.color ?? ELEMENT_COLORS.roof,
      transparent: false,
      roughness: 0.85,
      castShadow: true,
    }
  }

  if (solid.elementKind === "slab") {
    return {
      color: material?.color ?? ELEMENT_COLORS.slab,
      transparent: false,
      roughness: 0.9,
      castShadow: false,
    }
  }

  if (solid.elementKind === "column") {
    return {
      color: material?.color ?? ELEMENT_COLORS.column,
      transparent: false,
      roughness: 0.8,
      castShadow: true,
    }
  }

  const wall = storey.walls.find((candidate) => candidate.id === solid.elementId)
  const fallback =
    wall?.type === "exterior"
      ? ELEMENT_COLORS.exterior
      : wall?.type === "load_bearing"
        ? ELEMENT_COLORS.load_bearing
        : wall?.type === "partition"
          ? ELEMENT_COLORS.partition
          : ELEMENT_COLORS.interior

  return {
    color: material?.color ?? fallback,
    transparent: false,
    roughness: 0.96,
    castShadow: true,
  }
}

/** Eksporterer den aktive 3D-visningen som PNG (brukes til miniatyrbilde). */
export function captureCanvasPng(container: HTMLElement | null): string | null {
  const canvas = container?.querySelector("canvas")
  if (!canvas) return null
  try {
    return (canvas as HTMLCanvasElement).toDataURL("image/png")
  } catch {
    return null
  }
}

export { worldFromPlan }
