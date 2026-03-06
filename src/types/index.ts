export interface SeriesMetadata {
  patientName: string;
  studyDescription: string;
  seriesDescription: string;
  rows: number;
  columns: number;
  numberOfSlices: number;
  pixelSpacing: [number, number];
  sliceThickness: number;
  imageOrientationPatient: number[];
}

export interface ViewportConfig {
  viewportId: string;
  type: 'orthogonal' | 'oblique';
  orientation?: 'AXIAL' | 'SAGITTAL' | 'CORONAL';
  viewPlaneNormal?: [number, number, number];
  viewUp?: [number, number, number];
}
