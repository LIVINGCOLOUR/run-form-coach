// MediaPipe Pose の点の番号
export const L = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFoot: 31,
  rightFoot: 32,
} as const

// 骨格を描くときにつなぐ線（片側ずつ）
export const SIDE_POINTS = {
  left: { ear: L.leftEar, shoulder: L.leftShoulder, elbow: L.leftElbow, wrist: L.leftWrist, hip: L.leftHip, knee: L.leftKnee, ankle: L.leftAnkle, heel: L.leftHeel, foot: L.leftFoot },
  right: { ear: L.rightEar, shoulder: L.rightShoulder, elbow: L.rightElbow, wrist: L.rightWrist, hip: L.rightHip, knee: L.rightKnee, ankle: L.rightAnkle, heel: L.rightHeel, foot: L.rightFoot },
} as const

// 全身が入っているかを見る点
export const KEY_POINTS = [L.nose, L.leftShoulder, L.rightShoulder, L.leftHip, L.rightHip, L.leftKnee, L.rightKnee, L.leftAnkle, L.rightAnkle]
