require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./src/models/User');
const connectDB = require('./src/configs/db');

const addAdmin = async () => {
    try {
        await connectDB();

        const email = 'uniqueengineering93@gmail.com';
        const name = 'unique';
        const password = 'uni@1993';
        const phone = '0000000000';

        let user = await User.findOne({ email });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        if (user) {
            console.log('User already exists. Updating to admin...');
            user.isAdmin = true;
            user.name = name;
            user.phone = phone;
            user.password = hashedPassword;
            await user.save();
            console.log('User updated successfully.');
        } else {
            console.log('Creating new admin user...');
            user = new User({
                name,
                email,
                phone,
                password: hashedPassword,
                isAdmin: true
            });
            await user.save();
            console.log('Admin user created successfully.');
        }
        process.exit(0);
    } catch (err) {
        console.error('Error adding admin:', err);
        process.exit(1);
    }
};

addAdmin();
