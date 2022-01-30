// =============================================================================
// Classroom Model
// (c) Mathigon
// =============================================================================


import crypto from 'crypto';
import {Document, model, Model, Schema} from 'mongoose';
import {unique} from '@mathigon/core';
import {isClassCode} from '../utilities/validate';
import {CourseAnalytics} from './analytics';
import {Progress} from './progress';
import {User, UserDocument} from './user';

const random = (length: number) => crypto.randomBytes(length).toString('base64').toUpperCase().replace(/[+/\-_0O]/g, 'A').slice(0, length);


export interface ClassroomDocument extends Document {
  title: string;
  code: string;
  admin: string;
  teachers: string[];
  students: string[];

  // Methods
  getStudents: () => Promise<UserDocument[]>;
}

interface ClassroomModel extends Model<ClassroomDocument> {
  // Static Methods
  getStudents: (user: UserDocument) => Promise<UserDocument[]>;
  getTeachers: (user: UserDocument) => Promise<UserDocument[]>;
  getDashboardData: () => Promise<unknown>;
  lookup: (code: string) => Promise<ClassroomDocument|undefined>;
  make: (title: string, admin: UserDocument) => ClassroomDocument;
}

const ClassroomSchema = new Schema<ClassroomDocument, ClassroomModel>({
  title: {type: String, required: true, maxLength: 32, trim: true},
  code: {type: String, index: true, unique: true, required: true},
  admin: {type: String, required: true},
  teachers: {type: [String], required: true, index: true, default: []},
  students: {type: [String], required: true, index: true, default: []}
}, {timestamps: true});

ClassroomSchema.methods.getStudents = async function() {
  const students = await User.find({id: this.students}).exec();
  return students.sort((a, b) => a.sortingName.localeCompare(b.sortingName));
};

ClassroomSchema.methods.getDashboardData = async function(this: ClassroomDocument) {
};

ClassroomSchema.statics.make = async function(title: string, admin: UserDocument) {
  const code = random(4) + '-' + random(4);
  return new Classroom({title: title || 'Untitled Class', code, admin: admin.id});
};

ClassroomSchema.statics.getTeachers = async function(user: UserDocument) {
  if (user.type !== 'student') return [];
  const classes = await Classroom.find({classesJoined: user.id}).exec();
  const teachers = unique(classes.flatMap(c => c.teachers));
  return User.find({id: {$in: teachers}});
};

ClassroomSchema.statics.getStudents = async function(user: UserDocument) {
  if (user.type === 'student') return [];
  const classes = await Classroom.find({classesManaged: user.id}).exec();
  const students = unique(classes.flatMap(c => c.students));
  return User.find({id: {$in: students}});
};

ClassroomSchema.statics.lookup = async function(code: string) {
  if (!isClassCode(code)) return;
  return Classroom.findOne({code}).exec();
};

export const Classroom = model<ClassroomDocument, ClassroomModel>('Classroom', ClassroomSchema);
