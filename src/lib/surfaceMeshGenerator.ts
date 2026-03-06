/**
 * Surface Mesh Generator
 *
 * Uses VTK.js marching cubes to extract a 3D triangle mesh surface
 * from a binary labelmap (Uint8Array). Returns a translucent vtkActor
 * ready to be added to a standalone VTK.js renderer.
 */

import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageMarchingCubes from '@kitware/vtk.js/Filters/General/ImageMarchingCubes';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SurfaceMeshParams {
  labelmapData: Uint8Array;
  dimensions: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
  direction: number[]; // 9-element row-major 3×3
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a translucent vtkActor surface mesh from a binary labelmap.
 *
 * Pipeline:
 *   Uint8Array → Float32Array → vtkImageData → vtkImageMarchingCubes
 *   → vtkPolyData → vtkMapper → vtkActor (translucent teal)
 */
export function generateSurfaceMeshActor(params: SurfaceMeshParams): typeof vtkActor {
  const { labelmapData, dimensions, spacing, origin, direction } = params;

  // 1. Create vtkImageData from the binary labelmap
  const imageData = vtkImageData.newInstance();
  imageData.setDimensions(dimensions[0], dimensions[1], dimensions[2]);
  imageData.setSpacing(spacing[0], spacing[1], spacing[2]);
  imageData.setOrigin(origin[0], origin[1], origin[2]);
  imageData.setDirection(direction);

  // Marching cubes works best with float data — convert from Uint8
  const floatData = new Float32Array(labelmapData.length);
  for (let i = 0; i < labelmapData.length; i++) {
    floatData[i] = labelmapData[i];
  }

  const scalars = vtkDataArray.newInstance({
    numberOfComponents: 1,
    values: floatData,
    name: 'labelmap',
  });
  imageData.getPointData().setScalars(scalars);

  // 2. Run marching cubes — isovalue 0.5 extracts the surface between 0 and 1
  const marchingCubes = vtkImageMarchingCubes.newInstance({
    contourValue: 0.5,
    computeNormals: true,
    mergePoints: true,
  });
  marchingCubes.setInputData(imageData);
  marchingCubes.update();

  const polyData = marchingCubes.getOutputData(0);

  // 3. Create mapper
  const mapper = vtkMapper.newInstance();
  mapper.setInputData(polyData);

  // 4. Create actor with translucent teal appearance
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);

  const prop = actor.getProperty();
  prop.setOpacity(0.4);
  prop.setColor(0.0, 0.8, 0.85);       // Teal matching app theme
  prop.setAmbient(0.3);
  prop.setDiffuse(0.7);
  prop.setSpecular(0.2);
  prop.setSpecularPower(20);
  prop.setBackfaceCulling(false);        // Show both sides when rotating

  return actor;
}

/**
 * Properly dispose of a surface mesh actor and its VTK pipeline objects.
 */
export function disposeSurfaceMeshActor(actor: typeof vtkActor): void {
  try {
    const mapper = actor.getMapper();
    if (mapper) {
      const inputData = mapper.getInputData();
      if (inputData && typeof inputData.delete === 'function') {
        inputData.delete();
      }
      if (typeof mapper.delete === 'function') {
        mapper.delete();
      }
    }
    if (typeof actor.delete === 'function') {
      actor.delete();
    }
  } catch {
    // Ignore cleanup errors
  }
}
