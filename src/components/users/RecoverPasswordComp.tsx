'use client';

import {useSearchParams} from "next/navigation";
import {useState} from "react";
import {api} from "@/lib";

export default function RecoverPasswordComp() {
    const params = useSearchParams();
    // the reset email contains a code to paste here; ?token= still works for old links
    const [token, setToken] = useState(params.get('token') ?? '');
    const [password, setPassword] = useState('');
    const [password2, setPassword2] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const sendRecoverPassword = async () => {
        setError('');
        setMessage('');

        if (!token.trim()) {
            setError("Enter the code from the email.");
            return;
        }

        if (password !== password2) {
            setError("Passwords do not match.");
            return;
        }

        try {
            setLoading(true);
            await api.auth.recoverPassword(token.trim(), password);
            setMessage("Your password has been successfully updated.");
            setPassword('');
            setPassword2('');
        } catch (e) {
            setError("An error occurred while resetting your password.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className="flex flex-col items-center justify-center min-h-screen py-12 px-4 sm:px-6 lg:px-8 bg-gray-50 dark:bg-gray-900">
            <div className="w-full max-w-md space-y-8">
                <div className="text-center">
                    <h2 className="mt-6 text-3xl font-extrabold text-gray-900 dark:text-white">
                        Reset Your Password
                    </h2>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                        Enter the code from the email and your new password.
                    </p>
                </div>

                <div
                    className="bg-white dark:bg-gray-800 py-8 px-6 shadow rounded-lg sm:px-10 border border-gray-200 dark:border-gray-700">
                    {message && (
                        <div
                            className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-300 rounded-md p-4 mb-4 text-sm">
                            {message}
                        </div>
                    )}
                    {error && (
                        <div
                            className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-md p-4 mb-4 text-sm">
                            {error}
                        </div>
                    )}

                    <div className="space-y-6">
                        <div>
                            <label htmlFor="token"
                                   className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Reset Code
                            </label>
                            <input
                                id="token"
                                type="text"
                                autoComplete="one-time-code"
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                                required
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 dark:text-white dark:bg-gray-700 sm:text-sm font-mono"
                            />
                        </div>

                        <div>
                            <label htmlFor="password"
                                   className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                New Password
                            </label>
                            <input
                                id="password"
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 dark:text-white dark:bg-gray-700 sm:text-sm"
                            />
                        </div>

                        <div>
                            <label htmlFor="password2"
                                   className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Confirm New Password
                            </label>
                            <input
                                id="password2"
                                type="password"
                                placeholder="••••••••"
                                value={password2}
                                onChange={(e) => setPassword2(e.target.value)}
                                required
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 dark:text-white dark:bg-gray-700 sm:text-sm"
                            />
                        </div>

                        <div>
                            <button
                                onClick={sendRecoverPassword}
                                disabled={loading}
                                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-white transition"
                            >
                                {loading ? "Submitting..." : "Reset Password"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
