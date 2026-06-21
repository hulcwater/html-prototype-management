export type Bindings = {
  DB: D1Database;
  R2: R2Bucket;
};

export type Module = {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
  prototype_count?: number;
};

export type Prototype = {
  id: number;
  name: string;
  description: string;
  module_id: number;
  module_name?: string;
  preview_id: string;
  created_at: string;
  updated_at: string;
  has_file?: boolean;
};

export type UploadRecord = {
  id: number;
  prototype_id: number;
  file_name: string;
  r2_key: string;
  file_size: number;
  file_type: string;
  upload_time: string;
  uploader: string;
  update_notes: string;
};
