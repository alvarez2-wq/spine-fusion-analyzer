/**
 * Cornerstone3D segmentation pipeline for ROI volume overlays.
 *
 * Creates a derived labelmap volume and renders the ROI contour volume
 * on all viewports.
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

const ROI_SEG_VOLUME_ID = 'roi-volume-labelmap';
const ROI_SEGMENTATION_ID = 'roi-volume-segmentation';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createROISegmentation(
  referencedVolumeId: string,
  labelmapData: Uint8Array,
  viewportIds: string[],
): Promise<void> {
  // Clean up any previous ROI segmentation first
  removeROISegmentation(viewportIds);

  // 1. Create a derived labelmap volume
  const segVolume = volumeLoader.createAndCacheDerivedLabelmapVolume(
    referencedVolumeId,
    { volumeId: ROI_SEG_VOLUME_ID },
  );

  // 2. Copy labelmap data
  let segScalar: Uint8Array;
  try {
    segScalar = segVolume.getScalarData() as Uint8Array;
  } catch {
    const vm = (segVolume as unknown as { voxelManager: { getCompleteScalarDataArray: () => Uint8Array } }).voxelManager;
    if (vm?.getCompleteScalarDataArray) {
      segScalar = vm.getCompleteScalarDataArray();
    } else {
      throw new Error('Cannot access ROI segmentation volume scalar data');
    }
  }
  segScalar.set(labelmapData);

  // 3. Register the segmentation with a single segment (the ROI)
  segmentation.addSegmentations([
    {
      segmentationId: ROI_SEGMENTATION_ID,
      representation: {
        type: ToolEnums.SegmentationRepresentations.Labelmap,
        data: {
          volumeId: ROI_SEG_VOLUME_ID,
          referencedVolumeId,
        },
      },
      config: {
        label: 'ROI Volume',
        segments: {
          1: {
            segmentIndex: 1,
            label: 'ROI',
            locked: false,
            cachedStats: {},
          },
        },
      },
    },
  ]);

  // 4. Color LUT: index 0 = transparent, index 1 = ROI color (cyan/teal with transparency)
  const colorLUT: Types.ColorLUT = [
    [0, 0, 0, 0],        // background
    [0, 200, 220, 140],   // ROI: teal with moderate transparency
  ];

  const lutIndex = segmentation.state.addColorLUT(colorLUT);

  // 5. Add labelmap representation to all viewports
  const viewportInputMap: Record<
    string,
    Array<{ segmentationId: string; config?: { colorLUTOrIndex?: number } }>
  > = {};
  for (const vpId of viewportIds) {
    viewportInputMap[vpId] = [
      {
        segmentationId: ROI_SEGMENTATION_ID,
        config: { colorLUTOrIndex: lutIndex },
      },
    ];
  }
  segmentation.addLabelmapRepresentationToViewportMap(viewportInputMap);
}

export function removeROISegmentation(viewportIds: string[]): void {
  for (const vpId of viewportIds) {
    try {
      segmentation.removeLabelmapRepresentation(vpId, {
        segmentationId: ROI_SEGMENTATION_ID,
      });
    } catch {
      // ignore if not present
    }
  }

  try {
    segmentation.removeSegmentation(ROI_SEGMENTATION_ID);
  } catch {
    // ignore
  }

  try {
    const vol = cache.getVolume(ROI_SEG_VOLUME_ID);
    if (vol) {
      cache.removeVolumeLoadObject(ROI_SEG_VOLUME_ID);
    }
  } catch {
    // ignore
  }
}
