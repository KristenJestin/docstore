﻿using Docstore.App.Models.Forms;
using FluentValidation;

namespace Docstore.App.Validators
{
    public class DocumentCreateFormValidator : AbstractValidator<DocumentCreateForm>
    {
        public DocumentCreateFormValidator()
        {
            RuleFor(x => x.Name)
                .NotEmpty()
                .MaximumLength(255);

            RuleFor(x => x.Files)
                .Must(x => x == null || x.Any()).WithMessage("You must pick at least one file!")
                .Must(x => x == null || x.Count <= 20).WithMessage("You can't uploads more than 20 files!");

            RuleFor(x => x.Tags)
                .Must(x => x.Count() <= 25).When(x => x != null).WithMessage("You can't set more than 25 tags!");
        }
    }
}