/**
 * Cornerstone3D segmentation pipeline for vertebral body overlays.
 *
 * Creates a derived labelmap volume, registers it with the segmentation
 * state manager, and adds labelmap representations to viewports.
 */

import {
  cache,
  volumeLoader,
  type Types,
} from '@cornerstonejs/core';
import {
  segmentation,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';

import type { VertebraResult } from './vertebralFinder';

const SEG_VOLUME_ID = 'vertebrae-labelmap';
const SEGMENTATION_ID = 'vertebrae-segmentation';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createVertebralSegmentation(
  referencedVolumeId: string,
  labelmapData: Uint8Array,
  vertebrae: VertebraResult[],
  viewportIds: string[],
): Promise<void> {
  // Clean up any previous segmentation first
  removeVertebralSegmentation(viewportIds);

  // 1. Create a derived labelmap volume with the same geometry as the CT
  const segVolume = volumeLoader.createAndCacheDerivedLabelmapVolume(
    referencedVolumeId,
    { volumeId: SEG_VOLUME_ID },
  );

  // 2. Copy computed labelmap data into the segmentation volume
  // CS3D v4: getScalarData() may throw on VoxelManager-backed volumes
  let segScalar: Uint8Array;
  try {
    segScalar = segVolume.getScalarData() as Uint8Array;
  } catch {
    const vm = (segVolume as unknown as { voxelManager: { getCompleteScalarDataArray: () => Uint8Array } }).voxelManager;
    if (vm?.getCompleteScalarDataArray) {
      segScalar = vm.getCompleteScalarDataArray();
    } else {
      throw new Error('Cannot access segmentation volume scalar data');
    }
  }
  segScalar.set(labelmapData);

  // 3. Build segment config
  const segments: Record<number, { segmentIndex: number; label: string; locked: boolean; cachedStats: Record<string, unknown> }> = {};
  for (const v of vertebrae) {
    segments[v.label] = {
      segmentIndex: v.label,
      label: v.name,
      locked: false,
      cachedStats: {},
    };
  }

  // 4. Register the segmentation
  segmentation.addSegmentations([
    {
      segmentationId: SEGMENTATION_ID,
      representation: {
        type: ToolEnums.SegmentationRepresentations.Labelmap,
        data: {
          volumeId: SEG_VOLUME_ID,
          referencedVolumeId,
        },
      },
      config: {
        label: 'Vertebral Bodies',
        segments,
      },
    },
  ]);

  // 5. Build color LUT: index 0 = transparent background, then one color per vertebra
  const colorLUT: Types.ColorLUT = [[0, 0, 0, 0]]; // index 0
  for (const v of vertebrae) {
    // Pad if labels skip (they shouldn't, but just in case)
    while (colorLUT.length < v.label) {
      colorLUT.push([0, 0, 0, 0]);
    }
    colorLUT.push(v.color as [number, number, number, number]);
  }

  const lutIndex = segmentation.state.addColorLUT(colorLUT);

  // 6. Add labelmap representation to all viewports
  const viewportInputMap: Record<
    string,
    Array<{ segmentationId: string; config?: { colorLUTOrIndex?: number } }>
  > = {};
  for (const vpId of viewportIds) {
    viewportInputMap[vpId] = [
      {
        segmentationId: SEGMENTATION_ID,
        config: { colorLUTOrIndex: lutIndex },
      },
    ];
  }
  segmentation.addLabelmapRepresentationToViewportMap(viewportInputMap);
}

export function removeVertebralSegmentation(viewportIds: string[]): void {
  // Remove representations from each viewport
  for (const vpId of viewportIds) {
    try {
      segmentation.removeLabelmapRepresentation(vpId, {
        segmentationId: SEGMENTATION_ID,
      });
    } catch {
      // ignore if not present
    }
  }

  // Remove the segmentation from state
  try {
    segmentation.removeSegmentation(SEGMENTATION_ID);
  } catch {
    // ignore
  }

  // Remove the cached volume
  try {
    const vol = cache.getVolume(SEG_VOLUME_ID);
    if (vol) {
      cache.removeVolumeLoadObject(SEG_VOLUME_ID);
    }
  } catch {
    // ignore
  }
}
