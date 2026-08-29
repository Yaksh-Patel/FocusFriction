package com.focusfriction

import kotlin.random.Random

/**
 * FrictionEngine — generates the challenge shown in the pause overlay.
 *
 * Native because the overlay renders with no JavaScript runtime alive. Difficulty
 * scales with how many times the user has already opened this specific app today,
 * which is the whole premise: the cost goes up the more you cave.
 */
object FrictionEngine {

    data class Challenge(
        val mode: String,           // "math" | "typing" | "breathing"
        val prompt: String,         // what to show
        val expectedAnswer: String, // "" for breathing
        val difficulty: Int         // 1..3
    )

    private val TYPING_PHRASES = listOf(
        "I am choosing this on purpose",
        "This is not what I meant to do",
        "My time is worth more than this",
        "I will close this in five minutes",
        "There is something better waiting"
    )

    /** 1-3 opens easy, 4-5 medium, 6+ hard. */
    fun difficultyFor(dailyOpens: Int): Int = when {
        dailyOpens <= 3 -> 1
        dailyOpens <= 5 -> 2
        else -> 3
    }

    fun generate(enabledModes: List<String>, dailyOpens: Int): Challenge {
        val mode = enabledModes.randomOrNull() ?: "math"
        val difficulty = difficultyFor(dailyOpens)
        return when (mode) {
            "typing" -> Challenge("typing", TYPING_PHRASES.random(), "", difficulty)
            "breathing" -> Challenge("breathing", "", "", difficulty)
            else -> generateMath(difficulty)
        }
    }

    private fun generateMath(difficulty: Int): Challenge {
        // Arithmetic is built from explicit operands and evaluated directly — never
        // by parsing the display string back out.
        return when (difficulty) {
            1 -> {
                val plus = Random.nextBoolean()
                var a = Random.nextInt(10, 100)
                var b = Random.nextInt(10, 100)
                if (!plus && a < b) { val t = a; a = b; b = t }
                val answer = if (plus) a + b else a - b
                Challenge("math", "$a ${if (plus) "+" else "−"} $b", answer.toString(), 1)
            }
            2 -> {
                if (Random.nextBoolean()) {
                    val a = Random.nextInt(11, 21)
                    val b = Random.nextInt(4, 10)
                    Challenge("math", "$a × $b", (a * b).toString(), 2)
                } else {
                    val a = Random.nextInt(20, 51)
                    val b = Random.nextInt(10, 41)
                    val c = Random.nextInt(10, 31)
                    Challenge("math", "$a + $b − $c", (a + b - c).toString(), 2)
                }
            }
            else -> {
                if (Random.nextBoolean()) {
                    val a = Random.nextInt(11, 20)
                    val b = Random.nextInt(11, 20)
                    Challenge("math", "$a × $b", (a * b).toString(), 3)
                } else {
                    val a = Random.nextInt(10, 31)
                    val b = Random.nextInt(10, 31)
                    val c = Random.nextInt(2, 7)
                    Challenge("math", "($a + $b) × $c", ((a + b) * c).toString(), 3)
                }
            }
        }
    }

    fun verify(challenge: Challenge, input: String): Boolean {
        val given = input.trim()
        if (given.isEmpty()) return false
        return when (challenge.mode) {
            "math" -> given.toIntOrNull()?.toString() == challenge.expectedAnswer
            // Forgiving on case and inner whitespace — the point is deliberate
            // transcription, not perfect typing.
            "typing" -> given.replace(Regex("\\s+"), " ").equals(challenge.prompt, ignoreCase = true)
            else -> true
        }
    }
}
