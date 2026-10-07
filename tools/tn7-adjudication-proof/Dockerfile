FROM postgres:16
WORKDIR /proof
COPY db/005_operator_audit.sql /proof/005_operator_audit.sql
COPY db/006_data_issue_rejected_status.sql /proof/006_data_issue_rejected_status.sql
COPY tools/tn7-adjudication-proof/setup.sh /proof/setup.sh
RUN chmod +x /proof/setup.sh
CMD ["/proof/setup.sh"]
